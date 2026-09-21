// Run: node scripts/check-parse-intent.mjs   (node 24 strips the TS types itself)
import assert from 'node:assert/strict'

import { parseIntent } from '../src/features/cue/data-access/parse-intent.ts'

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

console.log('parse-intent: all checks passed')
