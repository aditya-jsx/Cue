// Run: node scripts/check-poll-stats.mjs
import assert from 'node:assert/strict'

import { describePollStats, recordPoll } from '../src/features/prices/util/poll-stats.ts'

const T = 1_000_000_000_000
let s = recordPoll(null, T)
assert.deepEqual(s, { count: 1, firstAt: T, lastAt: T, maxGapAt: T, maxGapMs: 0 })
s = recordPoll(s, T + 30_000)
s = recordPoll(s, T + 60_500)
assert.equal(s.count, 3)
assert.equal(s.maxGapMs, 30_500) // the longer of the two 30 s gaps
// A stall shows up as the longest gap, with when it ended.
s = recordPoll(s, T + 60_500 + 20 * 60_000)
assert.equal(s.maxGapMs, 20 * 60_000)
assert.equal(s.maxGapAt, T + 60_500 + 20 * 60_000)
// A later, shorter gap does not overwrite it.
s = recordPoll(s, s.lastAt + 30_000)
assert.equal(s.maxGapMs, 20 * 60_000)
assert.equal(s.count, 5)

assert.equal(describePollStats(null, T), 'No polls recorded yet')
assert.match(describePollStats(s, s.lastAt + 5000), /^5 polls over 22 min, longest gap 1200 s, last 5 s ago$/)
assert.match(
  describePollStats(
    { count: 960, firstAt: T, lastAt: T + 8 * 3_600_000, maxGapAt: T, maxGapMs: 31_000 },
    T + 8 * 3_600_000,
  ),
  /960 polls over 8\.0 h, longest gap 31 s/,
)

console.log('poll-stats: all checks passed')
