// Helius endpoints, from HELIUS_API_KEY_MAINNET / HELIUS_API_KEY_DEVNET (a bare key or a full https URL either works),
// or one HELIUS_API_KEY for both. Null when nothing is configured.
export function heliusUrl(cluster: 'devnet' | 'mainnet'): string | null {
  const value =
    (cluster === 'mainnet' ? process.env.HELIUS_API_KEY_MAINNET : process.env.HELIUS_API_KEY_DEVNET) ??
    process.env.HELIUS_API_KEY
  if (!value) return null
  return value.startsWith('https://') ? value : `https://${cluster}.helius-rpc.com/?api-key=${value}`
}
