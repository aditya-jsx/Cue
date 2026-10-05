// Run: node scripts/check-evaluate-triggers.mjs
import assert from 'node:assert/strict'

import { shouldFireTrigger } from '../src/features/price-triggers/util/should-fire-trigger.ts'
import { isPriceFresh, maxPriceAgeMs } from '../src/features/prices/util/price-freshness.ts'

// "below" fires when price has dropped to or under the target; "above" fires when it's risen to or over it.
assert.equal(shouldFireTrigger('below', 99, 100), true)
assert.equal(shouldFireTrigger('below', 100, 100), true)
assert.equal(shouldFireTrigger('below', 101, 100), false)
assert.equal(shouldFireTrigger('above', 101, 100), true)
assert.equal(shouldFireTrigger('above', 100, 100), true)
assert.equal(shouldFireTrigger('above', 99, 100), false)

// A price may be acted on only while it is recent: devnet feeds update ~every 5 min, mainnet ~every minute.
const now = 1_000_000_000_000
assert.equal(isPriceFresh(now - 1_000, now, 60_000), true)
assert.equal(isPriceFresh(now - 60_000, now, 60_000), true) // exactly at the limit still counts
assert.equal(isPriceFresh(now - 60_001, now, 60_000), false)
assert.equal(isPriceFresh(now + 5_000, now, 60_000), true) // a slightly fast clock must not block rules
assert.equal(maxPriceAgeMs('solana:mainnet'), 180_000)
assert.equal(maxPriceAgeMs('solana:devnet'), 600_000)
assert.equal(maxPriceAgeMs('solana:testnet'), 600_000)
assert.ok(maxPriceAgeMs('solana:devnet') > 5 * 60_000, 'devnet limit must exceed its ~5 min update cadence')
assert.ok(maxPriceAgeMs('solana:mainnet') > 60_000, 'mainnet limit must exceed its ~1 min update cadence')

console.log('evaluate-triggers: all checks passed')
