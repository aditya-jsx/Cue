// Run: node scripts/check-evaluate-triggers.mjs
import assert from 'node:assert/strict'

import { shouldFireTrigger } from '../src/features/price-triggers/util/should-fire-trigger.ts'
import { formatPct } from '../src/features/price-triggers/util/format-pct.ts'
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
assert.equal(maxPriceAgeMs('solana:devnet'), 75 * 60_000)
assert.equal(maxPriceAgeMs('solana:testnet'), 75 * 60_000)
assert.ok(maxPriceAgeMs('solana:devnet') > 60 * 60_000, "devnet limit must exceed the feeds' hour-long heartbeat")
assert.ok(maxPriceAgeMs('solana:mainnet') > 60_000, 'mainnet limit must exceed its ~1 min update cadence')

// Percent display: a tiny drop must not collapse to "0.0%".
assert.equal(formatPct(0.03), '0.03%')
assert.equal(formatPct(0.2), '0.20%')
assert.equal(formatPct(1), '1.0%')
assert.equal(formatPct(10.04), '10.0%')

console.log('evaluate-triggers: all checks passed')
