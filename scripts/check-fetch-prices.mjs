// Run: node scripts/check-fetch-prices.mjs
import assert from 'node:assert/strict'

import { parsePriceUpdateV2 } from '../src/features/prices/util/parse-price-update-v2.ts'
import { fetchPrices } from '../src/features/prices/util/fetch-prices.ts'
import { $prices, PRICE_FEED_ACCOUNTS } from '../src/features/prices/data-access/price-store.ts'

function buildAccount({ verificationVariant, price, exponent, publishTime }) {
  const buf = Buffer.alloc(120)
  let offset = 8 + 32 // discriminator + write_authority (unused)
  buf.writeUInt8(verificationVariant, offset)
  offset += verificationVariant === 0 ? 2 : 1
  offset += 32 // feed_id (unused, already known from which account we queried)
  buf.writeBigInt64LE(BigInt(price), offset)
  offset += 8 + 8 // price, conf (unused)
  buf.writeInt32LE(exponent, offset)
  offset += 4
  buf.writeBigInt64LE(BigInt(publishTime), offset)
  return buf
}

// parsePriceUpdateV2: both VerificationLevel variants (Full=1B, Partial{u8}=2B) must land on the same fields.
const full = buildAccount({ verificationVariant: 1, price: 15042, exponent: -2, publishTime: 1000 })
const parsedFull = parsePriceUpdateV2(full)
assert.ok(Math.abs(parsedFull.usd - 150.42) < 1e-9)
assert.equal(parsedFull.publishTimeMs, 1000_000)

const partial = buildAccount({ verificationVariant: 0, price: 85000000, exponent: -8, publishTime: 1001 })
const parsedPartial = parsePriceUpdateV2(partial)
assert.ok(Math.abs(parsedPartial.usd - 0.85) < 1e-9)
assert.equal(parsedPartial.publishTimeMs, 1001_000)

// fetchPrices: reads both configured accounts via client.rpc.getAccountInfo and writes into the shared store.
const accounts = {
  [PRICE_FEED_ACCOUNTS.SOL]: full,
  [PRICE_FEED_ACCOUNTS.JUP]: partial,
}
const client = {
  rpc: {
    getAccountInfo: (addr) => ({
      send: async () => {
        const data = accounts[addr]
        return data ? { value: { data: [data.toString('base64'), 'base64'] } } : { value: null }
      },
    }),
  },
}
await fetchPrices(client)
const prices = $prices.get()
assert.ok(Math.abs(prices.SOL.usd - 150.42) < 1e-9)
assert.ok(Math.abs(prices.JUP.usd - 0.85) < 1e-9)

// Missing account (null value) doesn't throw, just skips that symbol.
$prices.set({})
await fetchPrices({ rpc: { getAccountInfo: () => ({ send: async () => ({ value: null }) }) } })
assert.deepEqual($prices.get(), {})

console.log('fetch-prices: all checks passed')
