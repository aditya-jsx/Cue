// Run: node scripts/check-evaluate-triggers.mjs
import assert from 'node:assert/strict'

import { shouldFireTrigger } from '../src/features/price-triggers/util/should-fire-trigger.ts'

// "below" fires when price has dropped to or under the target; "above" fires when it's risen to or over it.
assert.equal(shouldFireTrigger('below', 99, 100), true)
assert.equal(shouldFireTrigger('below', 100, 100), true)
assert.equal(shouldFireTrigger('below', 101, 100), false)
assert.equal(shouldFireTrigger('above', 101, 100), true)
assert.equal(shouldFireTrigger('above', 100, 100), true)
assert.equal(shouldFireTrigger('above', 99, 100), false)

console.log('evaluate-triggers: all checks passed')
