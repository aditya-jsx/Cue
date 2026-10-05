// Plain-English text for the errors a mobile wallet (Phantom, Solflare) or the network can throw, so the user sees
// what happened and what to do instead of a library message. Returns null for anything it doesn't recognise.
// Codes are from the Mobile Wallet Adapter protocol: -1 authorization declined, -3 not signed, -4 not submitted.

type Coded = { code?: unknown; message?: unknown; name?: unknown }

export function describeWalletError(error: unknown): string | null {
  const e = (error && typeof error === 'object' ? error : {}) as Coded
  const message = typeof e.message === 'string' ? e.message : typeof error === 'string' ? error : ''

  if (e.code === -1) return 'You declined the connection in your wallet.'
  if (e.code === -3) return 'You declined the request in your wallet. Nothing was sent.'
  if (e.code === -4) return "Your wallet signed the request but didn't send it. Nothing was sent."
  if (e.code === 'ERROR_WALLET_NOT_FOUND')
    return 'No compatible wallet found. Install Phantom or Solflare, then try again.'
  if (e.code === 'ERROR_SESSION_TIMEOUT') return "Your wallet didn't respond in time. Try again."
  if (e.code === 'ERROR_SESSION_CLOSED' || e.code === 'ERROR_ASSOCIATION_CANCELLED') {
    return 'The wallet closed before you answered. Try again.'
  }
  if (
    /UnknownHostException|Unable to resolve host|Network request failed|Failed to fetch|ENOTFOUND|ECONNREFUSED/i.test(
      message,
    )
  ) {
    return "Can't reach the network. Check your connection and try again."
  }
  return null
}
