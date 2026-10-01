// Run: node scripts/check-parse-intent.mjs   (node 24 strips the TS types itself)
import assert from 'node:assert/strict'

import { normalizeTranscript, parseIntent } from '../src/features/cue/data-access/parse-intent.ts'
import { toIntent } from '../src/features/cue/data-access/understand.ts'

assert.deepEqual(parseIntent('Send 2 SOL to Alex'), {
  amount: 2,
  intent: 'instant_send',
  recipient: 'Alex',
  token: 'SOL',
})
assert.deepEqual(parseIntent('send 0.5 to Mira'), {
  amount: 0.5,
  intent: 'instant_send',
  recipient: 'Mira',
  token: 'SOL',
})
assert.equal(parseIntent('Send 2 USDC to Alex').intent, 'unsupported')
assert.equal(parseIntent('Send 0 SOL to Alex').intent, 'unsupported')

const buy = { amount_usd: 20, condition: 'below', intent: 'conditional_buy', threshold_usd: 0.85, token: 'JUP' }
assert.deepEqual(parseIntent('Buy $20 of JUP if it drops to 85 cents'), buy)
assert.deepEqual(parseIntent('Buy $20 of JUP below 85 cents'), buy)
assert.deepEqual(parseIntent('Buy $20 of JUP below $0.85'), buy)
assert.equal(parseIntent('Buy $20 of JUP if it rises to $1.10').condition, 'above')

assert.deepEqual(parseIntent('Alert me if my portfolio drops 10% today'), {
  action: 'alert_only',
  intent: 'portfolio_guard',
  threshold_pct: 10,
  timeframe: '24h',
})
assert.equal(parseIntent('Pause everything if my portfolio drops 10% today').action, 'pause_activity')
assert.equal(parseIntent('Alert me if I drop 10%').intent, 'portfolio_guard')
assert.equal(parseIntent('Alert me if my portfolio drops 5% in an hour').timeframe, '1h')

assert.equal(parseIntent('Swap all my SOL to Bonk').intent, 'unsupported')
assert.equal(parseIntent('').intent, 'unsupported')
assert.equal(parseIntent('Buy $20 of BONK below $1').intent, 'unsupported')

// Transcripts the on-device recognizer actually produced on the Moto G62, and what they should parse as.
const heard = (text) => parseIntent(normalizeTranscript(text))
const sendAlex = { amount: 2, intent: 'instant_send', recipient: 'Alex', token: 'SOL' }
assert.deepEqual(heard('send to SOL to Alex'), sendAlex)
assert.deepEqual(heard('send to sold to Alex'), sendAlex)
assert.deepEqual(heard('Send 2 SOL to Alex.'), sendAlex)
assert.deepEqual(heard('send two SOL, to Alex'), sendAlex)
assert.equal(heard('send 0.5 soul to Alex').amount, 0.5)
assert.equal(heard('send .5 SOL to Alex').amount, 0.5)
assert.deepEqual(heard('Buy 20 dollars of JUP if it drops to 85 cents.'), buy)
assert.deepEqual(heard('buy twenty dollars worth of JUP below 85 cents'), buy)
assert.equal(heard('alert me if my portfolio drops ten percent today').threshold_pct, 10)
assert.equal(heard('pause everything if my portfolio drops 10 percent in an hour').action, 'pause_activity')
assert.equal(normalizeTranscript('send 1,000 SOL to Alex'), 'send 1,000 SOL to Alex')
assert.equal(normalizeTranscript('I want to go for it'), 'I want to go for it')

// Claude's reply crosses a trust boundary: well-formed answers become Intents, anything else is rejected.
const nulls = {
  action: null,
  amount: null,
  amount_usd: null,
  condition: null,
  reason: null,
  recipient: null,
  threshold_pct: null,
  threshold_usd: null,
  timeframe: null,
  token: null,
}
assert.deepEqual(toIntent({ ...nulls, amount: 2, intent: 'instant_send', recipient: 'Alex', token: 'sol' }), sendAlex)
assert.deepEqual(
  toIntent({
    ...nulls,
    amount_usd: 20,
    condition: 'below',
    intent: 'conditional_buy',
    threshold_usd: 0.85,
    token: 'jup',
  }),
  buy,
)
assert.equal(
  toIntent({ ...nulls, action: 'pause_activity', intent: 'portfolio_guard', threshold_pct: 10, timeframe: '1h' })
    .action,
  'pause_activity',
)
assert.equal(toIntent({ ...nulls, intent: 'unsupported', reason: 'Nope.' }).reason, 'Nope.')
assert.equal(toIntent({ ...nulls, amount: '2', intent: 'instant_send', recipient: 'Alex' }), null)
assert.equal(toIntent({ ...nulls, intent: 'conditional_buy', token: 'JUP' }), null)
assert.equal(toIntent({ intent: 'drain_wallet' }), null)
assert.equal(toIntent('send 2 SOL'), null)

console.log('parse-intent: all checks passed')
