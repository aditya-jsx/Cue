import {
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  type Transaction,
} from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { confirmSignature } from '@/features/wallet/util/confirm-signature'

/**
 * Broadcasts a signed transaction and waits for it to land. Built for devnet, where a blockhash can expire in ~35s
 * (about a Phantom approval long) and the public RPC load-balances across nodes that lag each other:
 * - no preflight: the simulation step is what rejects a fresh blockhash a lagging node hasn't seen yet, and the
 *   callers already check balance and fee before asking for a signature;
 * - the same signed bytes are re-sent every few seconds until confirmed or expired, since a single send can be
 *   dropped;
 * - a failure keeps the signature attached, because the transaction may still have landed.
 */
export async function sendAndConfirm({
  client,
  lastValidBlockHeight,
  transaction,
}: {
  client: SolanaClient
  lastValidBlockHeight: bigint
  transaction: Transaction
}): Promise<string> {
  const wire = getBase64EncodedWireTransaction(transaction)
  const signature = getSignatureFromTransaction(transaction)
  const send = () => client.rpc.sendTransaction(wire, { encoding: 'base64', skipPreflight: true }).send()

  await send()
  try {
    await confirmSignature({ lastValidBlockHeight, rebroadcast: send, rpc: client.rpc, signature })
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { signature })
  }
  return signature
}
