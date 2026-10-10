import { address } from '@solana/kit'

import type { SolanaClient } from '../../cluster/data-access/create-solana-client.ts'
import { JUPITER_PRICED, PRICE_FEED_ACCOUNTS, setPrice, type Symbol } from '../data-access/price-store.ts'
import { parsePriceUpdateV2 } from './parse-price-update-v2.ts'

/** Reads Pyth's sponsored on-chain price accounts directly via RPC (and Jupiter for the rest) into the price store. */
export async function fetchPrices(client: SolanaClient): Promise<void> {
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
