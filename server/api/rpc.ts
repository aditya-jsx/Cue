import { heliusUrl } from '../lib/helius.js'
import { identify, limit, rpcRules } from '../lib/rate-limit.js'

// Cue's own Solana RPC, so users never paste a key: the app's JSON-RPC calls are forwarded to Helius with the key kept
// here. Only the methods Cue actually uses pass, one call per request, under per-device limits and a daily ceiling.
const ALLOWED = new Set([
  'getAccountInfo',
  'getBalance',
  'getBlockHeight',
  'getFeeForMessage',
  'getLatestBlockhash',
  'getMinimumBalanceForRentExemption',
  'getMultipleAccounts',
  'getSignatureStatuses',
  'getSignaturesForAddress',
  'getSlot',
  'getTokenAccountBalance',
  'getTokenAccountsByOwner',
  'getTransaction',
  'sendTransaction',
  'simulateTransaction',
])
const MAX_BODY_BYTES = 200_000 // a signed transaction is under 2 KB; nothing Cue sends comes close

const rpcError = (id: unknown, message: string, status: number) =>
  Response.json({ error: { code: -32600, message }, id: id ?? null, jsonrpc: '2.0' }, { status })

export async function POST(request: Request): Promise<Response> {
  const token = process.env.CUE_CLIENT_TOKEN
  if (token && request.headers.get('x-cue-client') !== token) return new Response('Forbidden', { status: 403 })
  if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return new Response('Too large', { status: 413 })

  const body = (await request.json().catch(() => null)) as { id?: unknown; method?: unknown } | null
  if (!body || Array.isArray(body) || typeof body.method !== 'string') return rpcError(null, 'One JSON-RPC call', 400)
  if (!ALLOWED.has(body.method)) return rpcError(body.id, `Method not allowed: ${body.method}`, 400)

  const verdict = await limit(identify(request.headers), rpcRules)
  if (!verdict.ok) {
    console.warn('[rpc] rate limited', verdict.rule)
    return new Response('Slow down', { headers: { 'retry-after': String(verdict.retryAfterSec) }, status: 429 })
  }

  const cluster = new URL(request.url).searchParams.get('cluster') === 'mainnet' ? 'mainnet' : 'devnet'
  const upstreamUrl = heliusUrl(cluster)
  if (!upstreamUrl) return new Response('RPC not configured', { status: 503 })
  const upstream = await fetch(upstreamUrl, {
    body: JSON.stringify(body),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(15_000),
  }).catch((error: unknown) => {
    console.error('[rpc] upstream failed', String(error))
    return null
  })
  if (!upstream) return rpcError(body.id, 'RPC unavailable', 502)
  return new Response(await upstream.text(), {
    headers: { 'cache-control': 'no-store', 'content-type': 'application/json' },
    status: upstream.status,
  })
}
