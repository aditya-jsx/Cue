import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-kit'
import type { Account, AppIdentity } from '@wallet-ui/react-native-kit'
import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  compileTransactionMessage,
  createTransactionMessage,
  getBase64Decoder,
  getCompiledTransactionMessageEncoder,
  isAddress,
  type Blockhash,
  type Lamports,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type TransactionMessageBytesBase64,
} from '@solana/kit'

import { getTransferSolInstruction } from '@/features/wallet/util/get-transfer-sol-instruction'
import { sendAndConfirm } from '@/features/wallet/util/send-signed-transaction'

export interface ExecuteInstantSendOptions {
  account: Account
  amountLamports: Lamports | bigint
  chain: `${string}:${string}`
  client: SolanaClient
  destination: string
  identity: AppIdentity
}

/**
 * Signs and sends SOL instantly via Mobile Wallet Adapter with Phantom/Seed Vault:
 * 1. Fresh `authorize` in the session so it never fails on stale/unverified cached auth tokens.
 * 2. Fetches a 100% fresh blockhash immediately after authorization, giving the user a full 60-90s window.
 * 3. Uses `wallet.signTransactions` so Phantom only signs the payload (avoiding Phantom's congested devnet RPC broadcast).
 * 4. Broadcasts the signed transaction directly using Cue's configured RPC (e.g. Helius) for instant, reliable landing.
 */
export async function executeInstantSend({
  account,
  amountLamports,
  chain,
  client,
  destination,
  identity,
}: ExecuteInstantSendOptions): Promise<string> {
  const trimmedDestination = destination.trim()
  if (!isAddress(trimmedDestination)) {
    throw new Error('Invalid recipient address. Please enter a valid Solana public key.')
  }
  const destinationAddress = address(trimmedDestination)
  const amount = BigInt(amountLamports)
  if (amount <= 0n) {
    throw new Error('Amount must be greater than 0.')
  }

  // Pre-check fee and balance with an initial blockhash estimate
  const { value: initialBlockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
  const estimateMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(account.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(initialBlockhash, m),
    (m) => setTransactionMessageComputeUnitLimit(200_000, m),
    (m) => setTransactionMessageComputeUnitPrice(1_000n, m),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          amount,
          destination: destinationAddress,
          source: account.address,
        }),
        m,
      ),
  )

  const encodedMessage = getCompiledTransactionMessageEncoder().encode(compileTransactionMessage(estimateMessage))
  const [{ value: balance }, { value: fee }] = await Promise.all([
    client.rpc.getBalance(account.address, { commitment: 'confirmed' }).send(),
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

  // The blockhash is fetched only once Phantom is open and authorized: a devnet blockhash expires in ~35s, and the
  // approval itself takes most of that, so none of it can be spent on launching the wallet first.
  let freshBlockhash!: Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>

  // Connect & sign with Phantom in a single session
  const signedTx = await transact(async (wallet) => {
    await wallet.authorize({ chain, identity })
    const { value } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
    freshBlockhash = value

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(account.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(freshBlockhash, m),
      (m) => setTransactionMessageComputeUnitLimit(200_000, m),
      (m) => setTransactionMessageComputeUnitPrice(1_000n, m),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({
            amount,
            destination: destinationAddress,
            source: account.address,
          }),
          m,
        ),
    )

    const unsigned = compileTransaction(message)
    const [signed] = await wallet.signTransactions({ transactions: [unsigned] })
    return signed
  })

  // Broadcast via Cue's own RPC endpoint (bypassing Phantom's congested devnet proxy)
  return sendAndConfirm({ client, lastValidBlockHeight: freshBlockhash.lastValidBlockHeight, transaction: signedTx })
}
