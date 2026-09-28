import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  isSolanaError,
  SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND,
  type Transaction,
} from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'

const isBlockhashNotFound = (error: unknown) =>
  isSolanaError(error) &&
  (isSolanaError(error.cause, SOLANA_ERROR__TRANSACTION_ERROR__BLOCKHASH_NOT_FOUND) ||
    /blockhash not found/i.test(String(error.cause ?? '')))

/**
 * Broadcasts an already-signed transaction through Cue's RPC. The public devnet RPC load-balances across nodes, and
 * one that hasn't seen a just-fetched blockhash rejects preflight with BlockhashNotFound even though the signed
 * transaction is valid — resending the same bytes a moment later lands it, without asking the user to sign again.
 */
export async function sendSignedTransaction(client: SolanaClient, transaction: Transaction): Promise<string> {
  const wire = getBase64EncodedWireTransaction(transaction)
  for (let attempt = 1; ; attempt++) {
    try {
      await client.rpc.sendTransaction(wire, { encoding: 'base64', preflightCommitment: 'confirmed' }).send()
      return getSignatureFromTransaction(transaction)
    } catch (error) {
      if (attempt >= 4 || !isBlockhashNotFound(error)) throw error
      await new Promise((resolve) => setTimeout(resolve, 1000 * attempt))
    }
  }
}
