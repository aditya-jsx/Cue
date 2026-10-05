// Run: node scripts/check-swap-quote.mjs
import assert from 'node:assert/strict'

import { checkSwapQuote } from '../src/features/wallet/util/check-swap-quote.ts'

// 0.01 SOL at SOL $120 and JUP $0.35 is worth about 3.43 JUP (6 decimals).
const base = { amountLamports: 10_000_000n, solUsd: 120, tokenDecimals: 6, tokenUsd: 0.35 }
const quote = { inAmount: '10000000', outAmount: '3447164', priceImpactPct: '0', slippageBps: 50 }

assert.equal(checkSwapQuote({ ...base, quote }), null) // a normal, fair quote goes through
assert.equal(checkSwapQuote({ ...base, quote: { ...quote, outAmount: '3500000' } }), null) // better than market is fine
assert.equal(checkSwapQuote({ ...base, quote: { ...quote, outAmount: '3330000' } }), null) // ~2.9% worse is still inside the limit

// More than 3% worse than the market price: refuse.
assert.match(checkSwapQuote({ ...base, quote: { ...quote, outAmount: '3300000' } }), /worse than the market price/)
// A quote for some other amount than the rule's.
assert.match(checkSwapQuote({ ...base, quote: { ...quote, inAmount: '20000000' } }), /different amount/)
// Price impact is a fraction: 0.0388 is 3.88%, which is over the 1% limit; 0.005 (0.5%) is fine.
assert.match(checkSwapQuote({ ...base, quote: { ...quote, priceImpactPct: '0.0388' } }), /move the price 3\.9%/)
assert.equal(checkSwapQuote({ ...base, quote: { ...quote, priceImpactPct: '0.005' } }), null)
// Too much slippage allowed.
assert.match(checkSwapQuote({ ...base, quote: { ...quote, slippageBps: 300 } }), /slippage/)
// No usable market price, an empty quote and garbage numbers never pass.
assert.match(checkSwapQuote({ ...base, tokenUsd: 0, quote }), /no market price/)
assert.match(checkSwapQuote({ ...base, quote: { ...quote, outAmount: '0' } }), /returns nothing/)
assert.match(checkSwapQuote({ ...base, quote: { ...quote, priceImpactPct: 'abc' } }), /no price impact/)

console.log('swap-quote: all checks passed')
