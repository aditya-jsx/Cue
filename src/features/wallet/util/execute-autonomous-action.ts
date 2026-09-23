import type { Address } from '@solana/kit'
import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import {
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  getBase64EncodedWireTransaction,
  getSignatureFromTransaction,
  partiallySignTransactionWithSigners,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'

import { getSessionKey } from '@/features/cue/data-access/session-key'
import { confirmSignature } from '@/features/wallet/util/confirm-signature'
import {
  findAtaAddress,
  getCreateAssociatedTokenAccountIdempotentInstruction,
  getTransferTokenInstruction,
  NATIVE_MINT_ADDRESS,
} from '@/features/wallet/util/spl-token'

const DEFAULT_TRANSFER_LAMPORTS = 10_000_000n // 0.01 WSOL, well inside the 0.05 WSOL approved cap

export interface ExecuteAutonomousActionResult {
  destinationAta: Address
  signature: string
  sourceAta: Address
}

/**
 * Proves the autonomous half of delegation: the session key spends from the owner's already-approved WSOL
 * allowance and pays its own gas, entirely locally — no wallet, no Phantom, no user present. This is the exact
 * shape Conditional Buy's trigger engine will call later (with a real swap instruction in place of the transfer).
 */
export async function executeAutonomousAction({
  client,
  ownerAddress,
  transferLamports = DEFAULT_TRANSFER_LAMPORTS,
}: {
  client: SolanaClient
  ownerAddress: Address
  transferLamports?: bigint
}): Promise<ExecuteAutonomousActionResult> {
  const sessionKey = await getSessionKey()
  if (!sessionKey) {
    throw new Error('No session key found. Grant delegation first (Home → Buy → Approve).')
  }

  const sourceAta = await findAtaAddress(ownerAddress, NATIVE_MINT_ADDRESS)
  const destinationAta = await findAtaAddress(sessionKey.address, NATIVE_MINT_ADDRESS)

  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const message = appendTransactionMessageInstructions(
    [
      getCreateAssociatedTokenAccountIdempotentInstruction({
        associatedToken: destinationAta,
        mint: NATIVE_MINT_ADDRESS,
        owner: sessionKey.address,
        payer: sessionKey.address,
      }),
      getTransferTokenInstruction({
        amount: transferLamports,
        authority: sessionKey.address,
        destination: destinationAta,
        source: sourceAta,
      }),
    ],
    setTransactionMessageLifetimeUsingBlockhash(
      latestBlockhash,
      setTransactionMessageFeePayer(sessionKey.address, createTransactionMessage({ version: 0 })),
    ),
  )

  const signed = await partiallySignTransactionWithSigners([sessionKey], compileTransaction(message))
  const signature = getSignatureFromTransaction(signed)

  await client.rpc
    .sendTransaction(getBase64EncodedWireTransaction(signed), { encoding: 'base64', preflightCommitment: 'confirmed' })
    .send()

  try {
    await confirmSignature({ lastValidBlockHeight: latestBlockhash.lastValidBlockHeight, rpc: client.rpc, signature })
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { signature })
  }

  return { destinationAta, signature, sourceAta }
}
