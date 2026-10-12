import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-kit'
import type { Account, AppIdentity } from '@wallet-ui/react-native-kit'
import {
  type Address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64Encoder,
  getTransactionDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { fetchQuote, fetchSwap, routeDexes } from '@/features/wallet/util/jupiter'
import { withWholeLamportPriority } from '@/features/wallet/util/whole-lamport-priority'
import { sendAndConfirm } from '@/features/wallet/util/send-signed-transaction'
import { getSessionKey } from '@/features/cue/data-access/session-key'
import { solOnChain } from '@/features/cue/data-access/voice-allowance'
import { getTransferSolInstruction } from '@/features/wallet/util/get-transfer-sol-instruction'
import {
  findAtaAddress,
  getApproveInstruction,
  getCreateAssociatedTokenAccountIdempotentInstruction,
  getSyncNativeInstruction,
  NATIVE_MINT_ADDRESS,
} from '@/features/wallet/util/spl-token'
import { CUE_FEE_BPS, CUE_TREASURY } from '@/features/wallet/util/tokens'

const SLIPPAGE_BPS = 50
/**
 * Where Cue's 0.5% goes for a swap: the treasury's account for the token bought, else for the token sold (Jupiter takes
 * either), else nowhere. A swap never fails because the treasury has no account for these tokens yet.
 */
async function feeAccountFor(client: SolanaClient, inputMint: Address, outputMint: Address) {
  if (!CUE_TREASURY) return undefined
  for (const mint of [outputMint, inputMint]) {
    const ata = await findAtaAddress(CUE_TREASURY, mint)
    const exists = await client.rpc
      .getAccountInfo(ata, { commitment: 'confirmed', encoding: 'base64' })
      .send()
      .then((r) => r.value !== null)
    if (exists) return ata
  }
  return undefined
}

/**
 * Cue's voice allowance is wrapped SOL in the wallet's own wrapped-SOL account, approved for Cue's key. A swap in or out
 * of SOL ends by closing that account (Jupiter's unwrap), which hands the SOL back but silently ends the allowance. This
 * builds a second transaction that puts it back as it was: the same SOL wrapped again, the same amount approved again.
 */
async function keepAllowance(client: SolanaClient, owner: Address) {
  const key = await getSessionKey()
  if (!key) return null
  const { approved, wrapped } = await solOnChain(client, owner)
  if (approved === 0n) return null
  const ata = await findAtaAddress(owner, NATIVE_MINT_ADDRESS)
  const { value: blockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(owner, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(blockhash, m),
    (m) =>
      appendTransactionMessageInstructions(
        [
          getCreateAssociatedTokenAccountIdempotentInstruction({
            associatedToken: ata,
            mint: NATIVE_MINT_ADDRESS,
            owner,
            payer: owner,
          }),
          getTransferSolInstruction({ amount: wrapped, destination: ata, source: owner }),
          getSyncNativeInstruction({ account: ata }),
          getApproveInstruction({ amount: approved, delegate: key.address, owner, source: ata }),
        ],
        m,
      ),
  )
  return { lastValidBlockHeight: blockhash.lastValidBlockHeight, transaction: compileTransaction(message) }
}

/**
 * A swap the user signs in Phantom (e.g. SKR -> SOL): unlike buy rules it spends the wallet's own tokens, which Cue has
 * no permission over. The quote is fetched once Phantom is open, so the signed transaction's blockhash is fresh.
 * Returns the signature and how much arrived (in the output token's base units, as quoted).
 */
const SOL_FEE_RESERVE = 5_000_000n // 0.005 SOL left for the network fee, priority and a new token account's rent

async function tokenBalance(client: SolanaClient, owner: Address, mint: Address): Promise<bigint> {
  const ata = await findAtaAddress(owner, mint)
  return client.rpc
    .getTokenAccountBalance(ata, { commitment: 'confirmed' })
    .send()
    .then((r) => BigInt(r.value.amount))
    .catch(() => 0n) // no account means none held
}

const notEnough = (held: bigint, amount: bigint, decimals: number, symbol: string, keepsFee: boolean) => {
  const show = (units: bigint) => Number((Number(units) / 10 ** decimals).toFixed(4)).toString()
  return `You have ${show(held)} ${symbol}, less than the ${show(amount)} you asked to swap${keepsFee ? ' plus a little for fees' : ''}.`
}

export async function executeWalletSwap({
  account,
  amount,
  chain,
  client,
  identity,
  inputDecimals,
  inputMint,
  inputSymbol,
  outputMint,
}: {
  account: Account
  amount: bigint
  inputDecimals: number
  inputSymbol: string
  chain: `${string}:${string}`
  client: SolanaClient
  identity: AppIdentity
  inputMint: Address
  outputMint: Address
}): Promise<{ note?: string; outAmount: bigint; signature: string }> {
  // Enough to swap? Asked before Phantom opens, in plain words rather than Jupiter's error code.
  const held =
    inputMint === NATIVE_MINT_ADDRESS
      ? await client.rpc
          .getBalance(account.address, { commitment: 'confirmed' })
          .send()
          .then((r) => r.value)
      : await tokenBalance(client, account.address, inputMint)
  const reserve = inputMint === NATIVE_MINT_ADDRESS ? SOL_FEE_RESERVE : 0n
  if (held < amount + reserve) {
    const message = notEnough(held, amount, inputDecimals, inputSymbol, reserve > 0n)
    // The Home balance counts SOL set aside for Cue too; say why it can't be swapped.
    const setAside = inputMint === NATIVE_MINT_ADDRESS ? (await solOnChain(client, account.address)).wrapped : 0n
    throw new Error(
      setAside > 0n
        ? `${message} Another ${Number((Number(setAside) / 1e9).toFixed(4))} SOL is set aside for Cue's voice approvals; Revoke in Settings frees it.`
        : message,
    )
  }
  const feeAccount = await feeAccountFor(client, inputMint, outputMint)
  let lastValidBlockHeight = 0n
  let outAmount = 0n
  let restore: Awaited<ReturnType<typeof keepAllowance>> = null
  const [signed, signedRestore] = await transact(async (wallet) => {
    await wallet.authorize({ chain, identity })
    const build = async (excludeDexes?: string[]) => {
      const quote = await fetchQuote({
        amount,
        excludeDexes,
        inputMint,
        outputMint,
        platformFeeBps: feeAccount ? CUE_FEE_BPS : undefined,
        slippageBps: SLIPPAGE_BPS,
      })
      const swap = await fetchSwap({ feeAccount, quote, userPublicKey: account.address, wrapAndUnwrapSol: true })
      return { quote, swap }
    }
    let { quote, swap } = await build()
    // Jupiter's router sometimes picks a pool that no longer trades ("Pool disabled"): ask once for a route that avoids
    // the exchanges the failed one went through. Not for a shortfall, which no other route fixes.
    if (swap.simulationError && !/insufficient|debit an account|0x1\b/i.test(JSON.stringify(swap.simulationError))) {
      ;({ quote, swap } = await build(routeDexes(quote)))
    }
    if (swap.simulationError) {
      const detail = JSON.stringify(swap.simulationError)
      throw new Error(
        /insufficient|debit an account|0x1\b/i.test(detail)
          ? "You don't have enough for that swap (including the network fee)."
          : `Jupiter's test run of the swap failed: ${detail.slice(0, 160)}`,
      )
    }
    lastValidBlockHeight = BigInt(swap.lastValidBlockHeight)
    outAmount = BigInt(quote.outAmount)
    const unsigned = withWholeLamportPriority(
      getTransactionDecoder().decode(getBase64Encoder().encode(swap.swapTransaction)),
    )
    const touchesSol = inputMint === NATIVE_MINT_ADDRESS || outputMint === NATIVE_MINT_ADDRESS
    restore = touchesSol ? await keepAllowance(client, account.address) : null
    // One approval in Phantom for both; the second is only sent once the swap has gone through.
    return wallet.signTransactions({ transactions: restore ? [unsigned, restore.transaction] : [unsigned] })
  })
  const signature = await sendAndConfirm({ client, lastValidBlockHeight, transaction: signed })
  const kept = restore as Awaited<ReturnType<typeof keepAllowance>> // set inside the wallet session above
  if (!kept || !signedRestore) return { outAmount, signature }
  try {
    await sendAndConfirm({ client, lastValidBlockHeight: kept.lastValidBlockHeight, transaction: signedRestore })
    return { outAmount, signature }
  } catch {
    return {
      note: "The swap went through, but Cue's voice allowance couldn't be put back. The SOL is in your wallet; turn voice approvals on again in Settings.",
      outAmount,
      signature,
    }
  }
}
