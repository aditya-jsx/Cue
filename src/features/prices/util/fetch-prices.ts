import { address } from '@solana/kit'

import type { SolanaClient } from '../../cluster/data-access/create-solana-client.ts'
import { PRICE_FEED_ACCOUNTS, setPrice, type Symbol } from '../data-access/price-store.ts'
import { parsePriceUpdateV2 } from './parse-price-update-v2.ts'

/** Reads Pyth's sponsored on-chain price accounts directly via RPC and updates the shared price store. */
export async function fetchPrices(client: SolanaClient): Promise<void> {
  const entries = Object.entries(PRICE_FEED_ACCOUNTS) as [Symbol, string][]

  await Promise.all(
    entries.map(async ([symbol, accountAddress]) => {
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
  )
}
