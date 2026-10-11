import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-kit'
import type { Account, AppIdentity } from '@wallet-ui/react-native-kit'
import { type Address, getBase64Encoder, getTransactionDecoder } from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { fetchQuote, fetchSwap } from '@/features/wallet/util/jupiter'
import { withWholeLamportPriority } from '@/features/wallet/util/whole-lamport-priority'
import { sendAndConfirm } from '@/features/wallet/util/send-signed-transaction'
import { findAtaAddress } from '@/features/wallet/util/spl-token'
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
 * A swap the user signs in Phantom (e.g. SKR -> SOL): unlike buy rules it spends the wallet's own tokens, which Cue has
 * no permission over. The quote is fetched once Phantom is open, so the signed transaction's blockhash is fresh.
 * Returns the signature and how much arrived (in the output token's base units, as quoted).
 */
export async function executeWalletSwap({
  account,
  amount,
  chain,
  client,
  identity,
  inputMint,
  outputMint,
}: {
  account: Account
  amount: bigint
  chain: `${string}:${string}`
  client: SolanaClient
  identity: AppIdentity
  inputMint: Address
  outputMint: Address
}): Promise<{ outAmount: bigint; signature: string }> {
  const feeAccount = await feeAccountFor(client, inputMint, outputMint)
  let lastValidBlockHeight = 0n
  let outAmount = 0n
  const signed = await transact(async (wallet) => {
    await wallet.authorize({ chain, identity })
    const quote = await fetchQuote({
      amount,
      inputMint,
      outputMint,
      platformFeeBps: feeAccount ? CUE_FEE_BPS : undefined,
      slippageBps: SLIPPAGE_BPS,
    })
    const swap = await fetchSwap({ feeAccount, quote, userPublicKey: account.address, wrapAndUnwrapSol: true })
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
    const [tx] = await wallet.signTransactions({ transactions: [unsigned] })
    return tx
  })
  const signature = await sendAndConfirm({ client, lastValidBlockHeight, transaction: signed })
  return { outAmount, signature }
}
