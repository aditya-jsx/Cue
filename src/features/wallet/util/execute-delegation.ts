import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-kit'
import type { Account, AppIdentity } from '@wallet-ui/react-native-kit'
import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import {
  type Address,
  appendTransactionMessageInstruction,
  type Blockhash,
  compileTransaction,
  compileTransactionMessage,
  createTransactionMessage,
  getBase64Decoder,
  getBase64EncodedWireTransaction,
  getCompiledTransactionMessageEncoder,
  getSignatureFromTransaction,
  pipe,
  setTransactionMessageComputeUnitLimit,
  setTransactionMessageComputeUnitPrice,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
  type TransactionMessageBytesBase64,
} from '@solana/kit'

import { clearSessionKey, getOrCreateSessionKey } from '@/features/cue/data-access/session-key'
import { confirmSignature } from '@/features/wallet/util/confirm-signature'
import { getTransferSolInstruction } from '@/features/wallet/util/get-transfer-sol-instruction'
import {
  findAtaAddress,
  getApproveInstruction,
  getCreateAssociatedTokenAccountIdempotentInstruction,
  getRevokeInstruction,
  getSyncNativeInstruction,
  NATIVE_MINT_ADDRESS,
} from '@/features/wallet/util/spl-token'

export interface ExecuteDelegationGrantOptions {
  account: Account
  approveAmountLamports?: bigint
  chain: `${string}:${string}`
  client: SolanaClient
  feeFundingLamports?: bigint
  identity: AppIdentity
  wrapAmountLamports?: bigint
}

export interface DelegationGrantResult {
  delegateAddress: Address
  ownerAta: Address
  signature: string
}

export interface ExecuteDelegationRevokeOptions {
  account: Account
  chain: `${string}:${string}`
  client: SolanaClient
  identity: AppIdentity
}

// Defaults for devnet testing:
// Wrap 0.05 SOL into WSOL, fund session key with 0.01 SOL gas, delegate 0.05 WSOL cap.
const DEFAULT_WRAP_LAMPORTS = 50_000_000n // 0.05 WSOL
const DEFAULT_FEE_FUNDING_LAMPORTS = 10_000_000n // 0.01 SOL for gas
const DEFAULT_APPROVE_LAMPORTS = 50_000_000n // 0.05 WSOL cap

/**
 * Grants on-chain delegation permission in a single atomic transaction:
 * 1. Derives user's WSOL Associated Token Account (ATA).
 * 2. Creates the WSOL ATA idempotently.
 * 3. Wraps SOL into WSOL and syncs the native balance.
 * 4. Funds the session keypair address with SOL for autonomous execution gas.
 * 5. Approves the session key as delegate for up to the cap amount.
 * 6. Signs via MWA and confirms on-chain.
 */
export async function executeDelegationGrant({
  account,
  approveAmountLamports = DEFAULT_APPROVE_LAMPORTS,
  chain,
  client,
  feeFundingLamports = DEFAULT_FEE_FUNDING_LAMPORTS,
  identity,
  wrapAmountLamports = DEFAULT_WRAP_LAMPORTS,
}: ExecuteDelegationGrantOptions): Promise<DelegationGrantResult> {
  const sessionKey = await getOrCreateSessionKey()
  const ownerAta = await findAtaAddress(account.address, NATIVE_MINT_ADDRESS)

  // Pre-flight balance check with fresh blockhash
  const { value: initialBlockhash } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()

  const estimateMessage = pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(account.address, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash(initialBlockhash, m),
    (m) => setTransactionMessageComputeUnitLimit(300_000, m),
    (m) => setTransactionMessageComputeUnitPrice(1_000n, m),
    (m) =>
      appendTransactionMessageInstruction(
        getCreateAssociatedTokenAccountIdempotentInstruction({
          associatedToken: ownerAta,
          mint: NATIVE_MINT_ADDRESS,
          owner: account.address,
          payer: account.address,
        }),
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          amount: wrapAmountLamports,
          destination: ownerAta,
          source: account.address,
        }),
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        getSyncNativeInstruction({
          account: ownerAta,
        }),
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({
          amount: feeFundingLamports,
          destination: sessionKey.address,
          source: account.address,
        }),
        m,
      ),
    (m) =>
      appendTransactionMessageInstruction(
        getApproveInstruction({
          amount: approveAmountLamports,
          delegate: sessionKey.address,
          owner: account.address,
          source: ownerAta,
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
    throw new Error('Unable to estimate delegation transaction fee. Please try again.')
  }

  const totalRequired = BigInt(fee) + wrapAmountLamports + feeFundingLamports
  if (balance < totalRequired) {
    const balSol = (Number(balance) / 1e9).toFixed(4)
    const reqSol = (Number(totalRequired) / 1e9).toFixed(4)
    throw new Error(
      `Insufficient SOL for delegation. Current balance: ${balSol} SOL, required: ${reqSol} SOL (including delegation deposit & session key gas).`,
    )
  }

  let freshBlockhash!: Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>

  const signedTx = await transact(async (wallet) => {
    await wallet.authorize({ chain, identity })
    const { value } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
    freshBlockhash = value

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(account.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(freshBlockhash, m),
      (m) => setTransactionMessageComputeUnitLimit(300_000, m),
      (m) => setTransactionMessageComputeUnitPrice(1_000n, m),
      (m) =>
        appendTransactionMessageInstruction(
          getCreateAssociatedTokenAccountIdempotentInstruction({
            associatedToken: ownerAta,
            mint: NATIVE_MINT_ADDRESS,
            owner: account.address,
            payer: account.address,
          }),
          m,
        ),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({
            amount: wrapAmountLamports,
            destination: ownerAta,
            source: account.address,
          }),
          m,
        ),
      (m) =>
        appendTransactionMessageInstruction(
          getSyncNativeInstruction({
            account: ownerAta,
          }),
          m,
        ),
      (m) =>
        appendTransactionMessageInstruction(
          getTransferSolInstruction({
            amount: feeFundingLamports,
            destination: sessionKey.address,
            source: account.address,
          }),
          m,
        ),
      (m) =>
        appendTransactionMessageInstruction(
          getApproveInstruction({
            amount: approveAmountLamports,
            delegate: sessionKey.address,
            owner: account.address,
            source: ownerAta,
          }),
          m,
        ),
    )

    const unsigned = compileTransaction(message)
    const [signed] = await wallet.signTransactions({ transactions: [unsigned] })
    return signed
  })

  const signature = getSignatureFromTransaction(signedTx)
  try {
    await client.rpc
      .sendTransaction(getBase64EncodedWireTransaction(signedTx), {
        encoding: 'base64',
        preflightCommitment: 'confirmed',
      })
      .send()
  } catch (err: unknown) {
    const rpcErr = err as { context?: { __serverMessage?: string; logs?: string[] }; message?: string }
    console.error('[CueDelegation] sendTransaction error details:', rpcErr?.context)
    const details = rpcErr?.context?.__serverMessage || rpcErr?.message || String(err)
    throw new Error(`Simulation/broadcast failed: ${details}`)
  }

  try {
    await confirmSignature({
      lastValidBlockHeight: freshBlockhash.lastValidBlockHeight,
      rpc: client.rpc,
      signature,
    })
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { signature })
  }

  return {
    delegateAddress: sessionKey.address,
    ownerAta,
    signature,
  }
}

/**
 * Revokes on-chain delegation permission via SPL Token revoke instruction:
 * 1. Derives user's WSOL ATA.
 * 2. Emits revoke() instruction for the source ATA with user as owner authority.
 * 3. Signs via MWA and confirms on-chain.
 * 4. Clears local session key.
 */
export async function executeDelegationRevoke({
  account,
  chain,
  client,
  identity,
}: ExecuteDelegationRevokeOptions): Promise<string> {
  const ownerAta = await findAtaAddress(account.address, NATIVE_MINT_ADDRESS)
  let freshBlockhash!: Readonly<{ blockhash: Blockhash; lastValidBlockHeight: bigint }>

  const signedTx = await transact(async (wallet) => {
    await wallet.authorize({ chain, identity })
    const { value } = await client.rpc.getLatestBlockhash({ commitment: 'confirmed' }).send()
    freshBlockhash = value

    const message = pipe(
      createTransactionMessage({ version: 0 }),
      (m) => setTransactionMessageFeePayer(account.address, m),
      (m) => setTransactionMessageLifetimeUsingBlockhash(freshBlockhash, m),
      (m) => setTransactionMessageComputeUnitLimit(150_000, m),
      (m) => setTransactionMessageComputeUnitPrice(1_000n, m),
      (m) =>
        appendTransactionMessageInstruction(
          getRevokeInstruction({
            owner: account.address,
            source: ownerAta,
          }),
          m,
        ),
    )

    const unsigned = compileTransaction(message)
    const [signed] = await wallet.signTransactions({ transactions: [unsigned] })
    return signed
  })

  const signature = getSignatureFromTransaction(signedTx)
  try {
    await client.rpc
      .sendTransaction(getBase64EncodedWireTransaction(signedTx), {
        encoding: 'base64',
        preflightCommitment: 'confirmed',
      })
      .send()
  } catch (err: unknown) {
    const rpcErr = err as { context?: { __serverMessage?: string; logs?: string[] }; message?: string }
    console.error('[CueDelegation] revoke sendTransaction error details:', rpcErr?.context)
    const details = rpcErr?.context?.__serverMessage || rpcErr?.message || String(err)
    throw new Error(`Simulation/broadcast failed: ${details}`)
  }

  try {
    await confirmSignature({
      lastValidBlockHeight: freshBlockhash.lastValidBlockHeight,
      rpc: client.rpc,
      signature,
    })
  } catch (error) {
    throw Object.assign(error instanceof Error ? error : new Error(String(error)), { signature })
  }

  // Clear session key from local storage upon successful revoke
  clearSessionKey()

  return signature
}
