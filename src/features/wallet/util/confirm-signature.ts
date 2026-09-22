import { assertIsSignature, type GetBlockHeightApi, type GetSignatureStatusesApi, type Rpc } from '@solana/kit'

export interface ConfirmSignatureOptions {
  // Omit for a durable-nonce transaction: it has no time-based expiry, so there's nothing to check against.
  lastValidBlockHeight?: bigint
  maxAttempts?: number
  pollIntervalMs?: number
  rpc: Rpc<GetBlockHeightApi & GetSignatureStatusesApi>
  signature: string
}

export async function confirmSignature({
  lastValidBlockHeight,
  maxAttempts = 30,
  pollIntervalMs = 1500,
  rpc,
  signature,
}: ConfirmSignatureOptions): Promise<string> {
  assertIsSignature(signature)

  let attempts = 0
  let expired = false

  while (attempts < maxAttempts) {
    attempts++

    try {
      const {
        value: [status],
      } = await rpc.getSignatureStatuses([signature]).send()

      if (status?.err) {
        throw new Error(`Transaction ${signature} failed on chain: ${JSON.stringify(status.err)}`)
      }

      if (status?.confirmationStatus === 'confirmed' || status?.confirmationStatus === 'finalized') {
        return signature
      }
    } catch (err) {
      const errMsg = err instanceof Error ? err.message : String(err)
      if (errMsg.includes('failed on chain')) {
        throw err
      }
      // Catch transient RPC errors (e.g. 429 rate limit or network lag) and retry
      console.warn(`[confirmSignature] Transient RPC issue on attempt ${attempts}:`, errMsg)
    }

    // Check block height only occasionally to prevent RPC rate limiting
    if (lastValidBlockHeight !== undefined && attempts % 4 === 0 && !expired) {
      try {
        const currentBlockHeight = await rpc.getBlockHeight({ commitment: 'confirmed' }).send()
        if (currentBlockHeight > lastValidBlockHeight) {
          expired = true
        }
      } catch {
        // Ignore transient RPC error when checking block height
      }
    }

    await new Promise((resolve) => setTimeout(resolve, pollIntervalMs))
  }

  // Final check after all attempts
  try {
    const {
      value: [finalStatus],
    } = await rpc.getSignatureStatuses([signature]).send()

    if (finalStatus?.err) {
      throw new Error(`Transaction ${signature} failed on chain: ${JSON.stringify(finalStatus.err)}`)
    }

    if (finalStatus?.confirmationStatus) {
      return signature
    }
  } catch (err) {
    const errMsg = err instanceof Error ? err.message : String(err)
    if (errMsg.includes('failed on chain')) {
      throw err
    }
  }

  throw new Error(
    lastValidBlockHeight === undefined
      ? "Couldn't confirm the transaction on-chain yet. Check your balance before trying again."
      : "Couldn't confirm the transaction on-chain. It may have expired, so check your balance before trying again.",
  )
}
