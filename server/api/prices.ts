import { heliusUrl } from '../lib/helius.js'
import { identify, limit } from '../lib/rate-limit.js'

// One price read for every phone: Pyth's mainnet on-chain prices (SOL, JUP) and Jupiter's for SKR (Pyth keeps no
// on-chain SKR account), cached ~15 s by Vercel's CDN. Phones' background checks ask here instead of each polling
// the chain every 30 s, which would burn through the RPC budget with a handful of users.
const PYTH_ACCOUNTS = {
  JUP: '7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5',
  SOL: '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
}
const SKR_MINT = 'SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3'

type Point = { publishTimeMs: number; usd: number }

// PriceUpdateV2 (pyth-solana-receiver-sdk): 8B discriminator, 32B write authority, verification level (2B or 1B),
// then feed id[32], price i64, conf u64, exponent i32, publish time i64. Same layout the app reads.
function parsePriceUpdateV2(data: Uint8Array): Point {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength)
  let offset = 8 + 32
  offset += view.getUint8(offset) === 0 ? 2 : 1
  offset += 32
  const price = view.getBigInt64(offset, true)
  offset += 16
  const exponent = view.getInt32(offset, true)
  offset += 4
  return { publishTimeMs: Number(view.getBigInt64(offset, true)) * 1000, usd: Number(price) * 10 ** exponent }
}

async function pythPrices(): Promise<Record<string, Point>> {
  const url = heliusUrl('mainnet') ?? 'https://api.mainnet-beta.solana.com'
  const symbols = Object.keys(PYTH_ACCOUNTS) as (keyof typeof PYTH_ACCOUNTS)[]
  const response = await fetch(url, {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'getMultipleAccounts',
      params: [symbols.map((s) => PYTH_ACCOUNTS[s]), { commitment: 'confirmed', encoding: 'base64' }],
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
    signal: AbortSignal.timeout(8000),
  })
  const { result } = (await response.json()) as { result?: { value: ({ data: [string, string] } | null)[] } }
  const out: Record<string, Point> = {}
  result?.value.forEach((account, i) => {
    if (account) out[symbols[i]] = parsePriceUpdateV2(Buffer.from(account.data[0], 'base64'))
  })
  return out
}

async function jupiterPrices(): Promise<Record<string, Point>> {
  const response = await fetch(`https://lite-api.jup.ag/price/v3?ids=${SKR_MINT}`, {
    signal: AbortSignal.timeout(8000),
  })
  const body = (await response.json()) as Record<string, { usdPrice?: unknown } | undefined>
  const usd = body[SKR_MINT]?.usdPrice
  return typeof usd === 'number' && usd > 0 ? { SKR: { publishTimeMs: Date.now(), usd } } : {}
}

export async function GET(request: Request): Promise<Response> {
  const verdict = await limit(identify(request.headers), [
    { by: 'ip', max: 240, name: 'prices-ip-minute', windowSec: 60 },
  ])
  if (!verdict.ok)
    return new Response('Slow down', { headers: { 'retry-after': String(verdict.retryAfterSec) }, status: 429 })
  const [pyth, jupiter] = await Promise.allSettled([pythPrices(), jupiterPrices()])
  const prices = {
    ...(pyth.status === 'fulfilled' ? pyth.value : {}),
    ...(jupiter.status === 'fulfilled' ? jupiter.value : {}),
  }
  if (!Object.keys(prices).length) return new Response('Prices unavailable', { status: 502 })
  return Response.json(
    { fetchedAt: Date.now(), prices },
    // Prices are public: let the CDN share one answer between every phone for ~15 s.
    { headers: { 'cache-control': 'public, s-maxage=15, stale-while-revalidate=30' } },
  )
}
