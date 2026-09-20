import type { Account } from '@wallet-ui/react-native-kit'
import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import {
  type Address,
  address,
  appendTransactionMessageInstruction,
  assertIsTransactionMessageWithSingleSendingSigner,
  compileTransactionMessage,
  createTransactionMessage,
  getBase58Decoder,
  getBase64Decoder,
  getCompiledTransactionMessageEncoder,
  isAddress,
  type Lamports,
  pipe,
  setTransactionMessageFeePayerSigner,
  setTransactionMessageLifetimeUsingBlockhash,
  signAndSendTransactionMessageWithSigners,
  type TransactionMessageBytesBase64,
  type TransactionSendingSigner,
} from '@solana/kit'

import { confirmSignature } from '@/features/wallet/util/confirm-signature'
import { getTransferSolInstruction } from '@/features/wallet/util/get-transfer-sol-instruction'

export interface ExecuteWalletSendSolOptions {
  account: Account
  amountLamports: Lamports | bigint
  client: SolanaClient
  destination: string
  getTransactionSigner: (address: Address, minContextSlot: bigint) => TransactionSendingSigner
}

export async function executeWalletSendSol({
  account,
  amountLamports,
  client,
  destination,
  getTransactionSigner,
}: ExecuteWalletSendSolOptions): Promise<string> {
  const trimmedDestination = destination.trim()

  if (!isAddress(trimmedDestination)) {
    throw new Error('Invalid recipient address. Please enter a valid Solana public key.')
  }

  const destinationAddress = address(trimmedDestination)
  const amount = BigInt(amountLamports)

  if (amount <= 0n) {
    throw new Error('Amount must be greater than 0.')
  }

  const {
    context: { slot: minContextSlot },
    value: latestBlockhash,
  } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()

  const transactionSigner = getTransactionSigner(account.address, minContextSlot)

  const message = pipe(
    createTransactionMessage({ version: 0 }),
    (transactionMessage) => setTransactionMessageFeePayerSigner(transactionSigner, transactionMessage),
    (transactionMessage) => setTransactionMessageLifetimeUsingBlockhash(latestBlockhash, transactionMessage),
    (transactionMessage) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          amount,
          destination: destinationAddress,
          source: transactionSigner.address,
        }),
        transactionMessage,
      ),
  )

  assertIsTransactionMessageWithSingleSendingSigner(message)

  const encodedMessage = getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(message))
  const [{ value: balance }, { value: fee }] = await Promise.all([
    client.rpc.getBalance(transactionSigner.address, { commitment: 'confirmed' }).send(),
    client.rpc
      .getFeeForMessage(getBase64Decoder().decode(encodedMessage) as TransactionMessageBytesBase64, {
        commitment: 'confirmed',
      })
      .send(),
  ])

  if (fee === null) {
    throw new Error('Unable to estimate the transaction fee. Try again with a fresh blockhash.')
  }

  const totalRequired = BigInt(fee) + amount
  if (balance < totalRequired) {
    const balanceSol = (Number(balance) / 1e9).toFixed(4)
    const requiredSol = (Number(totalRequired) / 1e9).toFixed(4)
    throw new Error(
      `Insufficient funds. Current balance is ${balanceSol} SOL, but ${requiredSol} SOL is required (including fee).`,
    )
  }

  const signatureBytes = await signAndSendTransactionMessageWithSigners(message)
  const signature = getBase58Decoder().decode(signatureBytes)

  if (!signature) {
    throw new Error('Transaction submitted but no signature was returned by the wallet adapter.')
  }

  // Wait for the transaction to confirm on chain
  try {
    await confirmSignature({
      lastValidBlockHeight: latestBlockhash.lastValidBlockHeight,
      rpc: client.rpc,
      signature,
    })
  } catch (confirmError) {
    const message = confirmError instanceof Error ? confirmError.message : String(confirmError)
    // If it's a verified on-chain failure, rethrow so the UI shows the real on-chain failure
    if (message.includes('failed on chain')) {
      throw confirmError
    }
    console.warn(
      '[executeWalletSendSol] Confirmation poll timed out or had RPC issue, but transaction was submitted:',
      signature,
      confirmError,
    )
  }

  return signature
}
