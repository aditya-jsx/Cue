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

  return message
}
