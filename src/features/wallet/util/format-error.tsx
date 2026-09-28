import { isSolanaError } from '@solana/kit'

export function formatError(error: unknown): string {
  let message = 'Unknown error occurred'

  if (error instanceof Error) {
    message = error.message
  } else if (error && typeof error === 'object' && 'message' in error) {
    message = String(error.message)
  } else if (typeof error === 'string' && error.trim().length > 0) {
    message = error
  }

  if (message.includes('UnknownHostException') || message.includes('Unable to resolve host')) {
    return 'DNS / Network Error (UnknownHostException): The device or emulator cannot reach the Solana RPC server. Please toggle Airplane Mode in your emulator to reset DNS, or check your internet connection.'
  }

  // The wallet session is cancelled when the user leaves the wallet app before answering.
  if (message.includes('CancellationException')) {
    return 'The wallet request was cancelled. Tap Confirm and sign to try again.'
  }

  // "Transaction simulation failed" alone says nothing — the real reason is the cause and the program log.
  if (isSolanaError(error)) {
    const logs = (error.context as { logs?: readonly string[] } | undefined)?.logs ?? []
    const failedLog = [...logs].reverse().find((line) => /failed|error|insufficient/i.test(line))
    const cause = error.cause ? formatError(error.cause) : ''
    return [message, cause, failedLog].filter(Boolean).join(' — ')
  }

  return message
}
