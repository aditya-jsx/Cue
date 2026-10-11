import { address } from '@solana/kit'

import type { SolanaClient } from '../../cluster/data-access/create-solana-client.ts'
import { JUPITER_PRICED, PRICE_FEED_ACCOUNTS, setPrice, type Symbol } from '../data-access/price-store.ts'
import { parsePriceUpdateV2 } from './parse-price-update-v2.ts'

/** Reads Pyth's sponsored on-chain price accounts directly via RPC (and Jupiter for the rest) into the price store. */
export async function fetchPrices(client: SolanaClient): Promise<void> {
  // Cue's server reads the prices once for every phone; reading the chain here is the fallback when it can't be reached.
  if (await fetchFromCue().catch((error) => (console.warn('[CuePriceEngine] Cue prices failed:', error), false))) return
  const entries = Object.entries(PRICE_FEED_ACCOUNTS) as [Symbol, string][]

  await Promise.all([
    fetchJupiterPrices().catch((error) => console.warn('[CuePriceEngine] Jupiter prices failed:', error)),
    ...entries.map(async ([symbol, accountAddress]) => {
      const { value } = await client.rpc
        .getAccountInfo(address(accountAddress), { commitment: 'confirmed', encoding: 'base64' })
        .send()

      if (!value) {
        console.warn(`[CuePriceEngine] No account data for ${symbol} (${accountAddress}).`)
        return
      }

      const bytes = Buffer.from(value.data[0], 'base64')
      setPrice(symbol, parsePriceUpdateV2(bytes))
    }),
  ])
}

const CUE_API = process.env.EXPO_PUBLIC_CUE_API_URL

/** True when Cue's server answered with prices (they're in the store then). */
async function fetchFromCue(): Promise<boolean> {
  if (!CUE_API) return false
  const response = await fetch(`${CUE_API}/api/prices`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const { prices } = (await response.json()) as { prices?: Record<string, { publishTimeMs?: unknown; usd?: unknown }> }
  let any = false
  for (const [symbol, point] of Object.entries(prices ?? {})) {
    if (typeof point.usd === 'number' && point.usd > 0 && typeof point.publishTimeMs === 'number') {
      setPrice(symbol as Symbol, { publishTimeMs: point.publishTimeMs, usd: point.usd })
      any = true
    }
  }
  return any
}

async function fetchJupiterPrices() {
  const entries = Object.entries(JUPITER_PRICED) as [Symbol, string][]
  const response = await fetch(`https://lite-api.jup.ag/price/v3?ids=${entries.map(([, mint]) => mint).join(',')}`)
  if (!response.ok) throw new Error(`HTTP ${response.status}`)
  const body = (await response.json()) as Record<string, { usdPrice?: unknown } | undefined>
  // ponytail: the reply has no timestamp, so a price counts as fresh when fetched; Jupiter serves it live.
  const now = Date.now()
  for (const [symbol, mint] of entries) {
    const usd = body[mint]?.usdPrice
    if (typeof usd === 'number' && usd > 0) setPrice(symbol, { publishTimeMs: now, usd })
  }
}
