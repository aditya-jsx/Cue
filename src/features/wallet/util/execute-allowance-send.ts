import {
  type Address,
  appendTransactionMessageInstructions,
  compileTransaction,
  createTransactionMessage,
  partiallySignTransactionWithSigners,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { getSessionKey } from '@/features/cue/data-access/session-key'
import { getTransferSolInstruction } from '@/features/wallet/util/get-transfer-sol-instruction'
import { sendAndConfirm } from '@/features/wallet/util/send-signed-transaction'
import {
  findAtaAddress,
  getCloseAccountInstruction,
  getCreateAssociatedTokenAccountIdempotentInstruction,
  getTransferTokenInstruction,
  NATIVE_MINT_ADDRESS,
} from '@/features/wallet/util/spl-token'

/**
 * A send approved by voice, paid from the voice allowance with no wallet prompt. One transaction, signed by the session
 * key alone: take `lamports` of the approved wrapped SOL, unwrap it (closing the session key's wrapped account returns
 * it as SOL, plus that account's rent), and pay the recipient plain SOL. All of it or none of it lands.
 */
export async function executeAllowanceSend({
  client,
  lamports,
  ownerAddress,
  recipient,
}: {
  client: SolanaClient
  lamports: bigint
  ownerAddress: Address
  recipient: Address
}): Promise<string> {
  const sessionKey = await getSessionKey()
  if (!sessionKey) throw new Error('Voice approvals are off. Turn them on in Settings.')
  const ownerWsol = await findAtaAddress(ownerAddress, NATIVE_MINT_ADDRESS)
  const sessionWsol = await findAtaAddress(sessionKey.address, NATIVE_MINT_ADDRESS)

  const { value: latestBlockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const message = appendTransactionMessageInstructions(
    [
      getCreateAssociatedTokenAccountIdempotentInstruction({
        associatedToken: sessionWsol,
        mint: NATIVE_MINT_ADDRESS,
        owner: sessionKey.address,
        payer: sessionKey.address,
      }),
      getTransferTokenInstruction({
        amount: lamports,
        authority: sessionKey.address,
        destination: sessionWsol,
        source: ownerWsol,
      }),
      getCloseAccountInstruction({ destination: sessionKey.address, owner: sessionKey.address, source: sessionWsol }),
      getTransferSolInstruction({ amount: lamports, destination: recipient, source: sessionKey.address }),
    ],
    setTransactionMessageLifetimeUsingBlockhash(
      latestBlockhash,
      setTransactionMessageFeePayer(sessionKey.address, createTransactionMessage({ version: 0 })),
    ),
  )
  const signed = await partiallySignTransactionWithSigners([sessionKey], compileTransaction(message))
  return sendAndConfirm({ client, lastValidBlockHeight: latestBlockhash.lastValidBlockHeight, transaction: signed })
}
