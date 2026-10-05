// Run: node scripts/check-spoken.mjs
import assert from 'node:assert/strict'

import { spokenConfirm, spokenPrice, spokenResult } from '../src/features/cue/util/spoken.ts'

// Prices are said the way a person says them.
assert.equal(spokenPrice(0.3), '30 cents')
assert.equal(spokenPrice(0.2), '20 cents')
assert.equal(spokenPrice(0.01), '1 cent')
assert.equal(spokenPrice(0.125), '12.5 cents')
assert.equal(spokenPrice(1), '1 dollar')
assert.equal(spokenPrice(1.25), '1.25 dollars')
assert.equal(spokenPrice(117.6), '117.6 dollars')

const send = { amount: 0.01, kind: 'send', recipientName: 'Alex' }
assert.equal(spokenConfirm(send), 'Send 0.01 SOL to Alex. Tap confirm and sign.')
assert.equal(spokenResult(send), 'Sent 0.01 SOL to Alex.')
// An unsaved recipient is a shortened address, which must not be read out as "B W G t dot dot dot".
assert.equal(
  spokenConfirm({ ...send, recipientName: 'BWGt…6bzv' }),
  'Send 0.01 SOL to the address ending 6 b z v. Tap confirm and sign.',
)

const buy = { amountUsd: 5, direction: 'below', kind: 'buy', symbol: 'JUP', targetUsd: 0.2 }
assert.equal(
  spokenConfirm(buy),
  'Buy 5 dollars of Jupiter when it falls to 20 cents. Tap review permission to continue.',
)
assert.equal(spokenResult(buy), "Rule is live. I'll buy 5 dollars of Jupiter when it falls to 20 cents.")
assert.match(spokenConfirm({ ...buy, amountUsd: 1, direction: 'above' }), /^Buy 1 dollar of Jupiter when it rises to/)

const guard = { action: 'pause_activity', kind: 'guard', thresholdPct: 15, timeframe: '1h' }
assert.equal(
  spokenConfirm(guard),
  'Watch for a 15 percent drop in an hour, and pause your buy rules. Tap turn on guard.',
)
assert.equal(
  spokenResult({ ...guard, action: 'alert_only', thresholdPct: 10, timeframe: '24h' }),
  "Guard is on. I'll alert you if your portfolio drops 10 percent in 24 hours.",
)

// A refusal is read as written; a refusal has no success message.
assert.equal(
  spokenConfirm({ kind: 'nope', reason: "I don't have a contact named Bob." }),
  "I don't have a contact named Bob.",
)
assert.equal(spokenResult({ kind: 'nope', reason: 'x' }), '')

console.log('spoken: all checks passed')
