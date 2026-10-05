import {
  type Address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
  partiallySignTransactionWithSigners,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import type { Symbol } from '@/features/prices/data-access/price-store'
import { getSessionKey } from '@/features/cue/data-access/session-key'
import { checkSwapQuote } from '@/features/wallet/util/check-swap-quote'
import { executeAutonomousAction } from '@/features/wallet/util/execute-autonomous-action'
import { fetchQuote, fetchSwap } from '@/features/wallet/util/jupiter'
import { sendAndConfirm } from '@/features/wallet/util/send-signed-transaction'
import {
  findAtaAddress,
  getCloseAccountInstruction,
  getCreateAssociatedTokenAccountIdempotentInstruction,
  getTransferTokenInstruction,
  NATIVE_MINT_ADDRESS,
} from '@/features/wallet/util/spl-token'
import { BUYABLE_TOKENS } from '@/features/wallet/util/tokens'

const SLIPPAGE_BPS = 50 // 0.5%

/** The buy was turned away before any money moved (bad price, no quote, network). Safe to try again later. */
export class SwapNotStartedError extends Error {}

export interface ExecuteSwapResult {
  deliverSignature: string
  received: bigint // token base units that reached the user's wallet
  swapSignature: string
}

async function requireSessionKey() {
  const sessionKey = await getSessionKey()
  if (!sessionKey) throw new Error('No session key found. Grant delegation first (Home → Buy → Approve).')
  return sessionKey
}

/** Signs and sends instructions as the session key, which is also the fee payer. */
async function sendAsSessionKey(
  client: SolanaClient,
  instructions: Parameters<typeof appendTransactionMessageInstructions>[0],
) {
  const sessionKey = await requireSessionKey()
  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const message = appendTransactionMessageInstructions(
    instructions,
    setTransactionMessageLifetimeUsingBlockhash(
      latestBlockhash,
      setTransactionMessageFeePayer(sessionKey.address, createTransactionMessage({ version: 0 })),
    ),
  )
  const signed = await partiallySignTransactionWithSigners([sessionKey], compileTransaction(message))
  return sendAndConfirm({ client, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight, transaction: signed })
}

/** Sends everything the session key holds of `mint` to the owner's wallet. Returns how much, or 0n if nothing. */
async function deliverToOwner({
  client,
  mint,
  ownerAddress,
}: {
  client: SolanaClient
  mint: Address
  ownerAddress: Address
}): Promise<{ amount: bigint; signature: string | null }> {
  const sessionKey = await requireSessionKey()
  const source = await findAtaAddress(sessionKey.address, mint)
  const held = await client.rpc
    .getTokenAccountBalance(source, { commitment: 'confirmed' })
    .send()
    .then((r) => BigInt(r.value.amount))
    .catch(() => 0n) // no account yet means nothing is held
  if (held === 0n) return { amount: 0n, signature: null }

  const destination = await findAtaAddress(ownerAddress, mint)
  const signature = await sendAsSessionKey(client, [
    getCreateAssociatedTokenAccountIdempotentInstruction({
      associatedToken: destination,
      mint,
      owner: ownerAddress,
      payer: sessionKey.address,
    }),
    getTransferTokenInstruction({ amount: held, authority: sessionKey.address, destination, source }),
  ])
  return { amount: held, signature }
}

/**
 * A real buy, done by the session key alone (no wallet prompt), inside what the user approved:
 *   1. move the approved WSOL from the user's account to the session key's own account (the delegated transfer),
 *   2. swap it for the token through Jupiter, signed by the session key,
 *   3. deliver the token to the user's wallet.
 * The quote is checked against the market price before any money moves, and again before the swap.
 */
export async function executeSwapBuy({
  amountLamports,
  client,
  ownerAddress,
  solUsd,
  symbol,
  tokenUsd,
}: {
  amountLamports: bigint
  client: SolanaClient
  ownerAddress: Address
  solUsd: number
  symbol: Symbol
  tokenUsd: number
}): Promise<ExecuteSwapResult> {
  const token = BUYABLE_TOKENS[symbol]
  if (!token) throw new Error(`Cue can't buy ${symbol} yet.`)
  const sessionKey = await requireSessionKey()
  const checkedQuote = async () => {
    const quote = await fetchQuote({
      amount: amountLamports,
      inputMint: NATIVE_MINT_ADDRESS,
      outputMint: token.mint,
      slippageBps: SLIPPAGE_BPS,
    })
    const refusal = checkSwapQuote({ amountLamports, quote, solUsd, tokenDecimals: token.decimals, tokenUsd })
    if (refusal) throw new Error(refusal)
    return quote
  }

  try {
    await checkedQuote() // refuse a bad price before any money moves
  } catch (error) {
    throw new SwapNotStartedError(error instanceof Error ? error.message : String(error), { cause: error })
  }
  await executeAutonomousAction({ client, ownerAddress, transferLamports: amountLamports }) // step 1

  try {
    const quote = await checkedQuote() // a fresh look right before swapping
    const swap = await fetchSwap({ quote, userPublicKey: sessionKey.address })
    if (swap.simulationError)
      throw new Error(`Jupiter's test run of the swap failed: ${JSON.stringify(swap.simulationError)}`)

    const unsigned = getTransactionDecoder().decode(getBase64Encoder().encode(swap.swapTransaction))
    const signed = await partiallySignTransaction([sessionKey.keyPair], unsigned) // the session key is its only signer
    const swapSignature = await sendAndConfirm({
      client,
      lastValidBlockHeight: BigInt(swap.lastValidBlockHeight),
      transaction: signed,
    })

    const delivered = await deliverToOwner({ client, mint: token.mint, ownerAddress }) // step 3
    return { deliverSignature: delivered.signature ?? '', received: delivered.amount, swapSignature }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    throw new Error(
      `${reason} The funds Cue moved for this buy stay with its session key and go back to your wallet if you revoke the permission.`,
      { cause: error },
    )
  }
}

/**
 * Sends anything left with the session key back to the user: tokens it bought but could not deliver, and wrapped
 * SOL it moved but could not swap (closing its account returns that as SOL). Safe to call when nothing is held.
 */
export async function returnSessionFunds({
  client,
  ownerAddress,
}: {
  client: SolanaClient
  ownerAddress: Address
}): Promise<void> {
  const sessionKey = await getSessionKey()
  if (!sessionKey) return
  for (const token of Object.values(BUYABLE_TOKENS)) {
    if (token) await deliverToOwner({ client, mint: token.mint, ownerAddress })
  }
  const sessionWsolAta = await findAtaAddress(sessionKey.address, NATIVE_MINT_ADDRESS)
  const exists = await client.rpc
    .getAccountInfo(sessionWsolAta, { commitment: 'confirmed', encoding: 'base64' })
    .send()
    .then((r) => r.value !== null)
  if (exists) {
    await sendAsSessionKey(client, [
      getCloseAccountInstruction({ destination: ownerAddress, owner: sessionKey.address, source: sessionWsolAta }),
    ])
  }
}
