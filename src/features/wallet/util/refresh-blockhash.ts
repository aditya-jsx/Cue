import {
  compileTransaction,
  decompileTransactionMessage,
  getCompiledTransactionMessageDecoder,
  type GetLatestBlockhashApi,
  type Rpc,
  setTransactionMessageLifetimeUsingBlockhash,
  type Transaction,
} from '@solana/kit'

const decoder = getCompiledTransactionMessageDecoder()

/**
 * Re-stamps transactions with the newest blockhash. Call it right before the wallet signs: a blockhash only lives
 * ~60s, and the wallet's connect + review steps can outlast one fetched earlier.
 * ponytail: no address lookup tables (decompile would throw); Cue's transfers and swaps-by-instruction don't need one yet.
 */
export async function refreshBlockhash(transactions: readonly Transaction[], rpc: Rpc<GetLatestBlockhashApi>) {
  const blockhash = await getLatestBlockhashRetrying(rpc)
  return transactions.map((tx) =>
    compileTransaction(
      setTransactionMessageLifetimeUsingBlockhash(
        blockhash,
        decompileTransactionMessage(decoder.decode(tx.messageBytes)),
      ),
    ),
  )
}

/** Public RPCs rate-limit with HTTP 429 in bursts (worse while a wallet app shares the network); back off and retry. */
async function getLatestBlockhashRetrying(rpc: Rpc<GetLatestBlockhashApi>) {
  for (let attempt = 0; ; attempt++) {
    try {
      return (await rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()).value
    } catch (error) {
      if (attempt >= 3 || !String(error).includes('429')) throw error
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** attempt))
    }
  }
}
