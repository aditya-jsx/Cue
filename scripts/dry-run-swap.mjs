// Run: node scripts/dry-run-swap.mjs
// A full rehearsal of the swap against the live network that SENDS NOTHING and needs no funds: real Jupiter quote,
// Cue's safety check against Pyth's mainnet prices, then the real swap transaction decoded and signed with a throwaway key.
import assert from 'node:assert/strict'

import {
  generateKeyPairSigner,
  getBase64EncodedWireTransaction,
  getBase64Encoder,
  getTransactionDecoder,
  partiallySignTransaction,
} from '@solana/kit'

import { checkSwapQuote } from '../src/features/wallet/util/check-swap-quote.ts'
import { fetchQuote, fetchSwap } from '../src/features/wallet/util/jupiter.ts'
import { parsePriceUpdateV2 } from '../src/features/prices/util/parse-price-update-v2.ts'

const SOL_MINT = 'So11111111111111111111111111111111111111112'
const JUP_MINT = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const FEEDS = {
  JUP: '7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5',
  SOL: '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
}

async function pythPrice(account) {
  const r = await fetch('https://api.mainnet-beta.solana.com', {
    body: JSON.stringify({
      id: 1,
      jsonrpc: '2.0',
      method: 'getAccountInfo',
      params: [account, { encoding: 'base64' }],
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
  const { result } = await r.json()
  return parsePriceUpdateV2(Buffer.from(result.value.data[0], 'base64'))
}

const [sol, jup] = await Promise.all([pythPrice(FEEDS.SOL), pythPrice(FEEDS.JUP)])
const age = (p) => Math.round((Date.now() - p.publishTimeMs) / 1000)
console.log(
  `Pyth mainnet: SOL $${sol.usd.toFixed(2)} (${age(sol)}s old), JUP $${jup.usd.toFixed(4)} (${age(jup)}s old)`,
)

const amountLamports = 10_000_000n // 0.01 SOL
const quote = await fetchQuote({ amount: amountLamports, inputMint: SOL_MINT, outputMint: JUP_MINT, slippageBps: 50 })
console.log(
  `Jupiter quote: 0.01 SOL -> ${Number(quote.outAmount) / 1e6} JUP, impact ${quote.priceImpactPct}, slippage ${quote.slippageBps} bps`,
)
const refusal = checkSwapQuote({ amountLamports, quote, solUsd: sol.usd, tokenDecimals: 6, tokenUsd: jup.usd })
console.log('Safety check:', refusal ?? 'passes')
assert.equal(refusal, null, 'a normal live quote should pass the safety check')

const throwaway = await generateKeyPairSigner() // never funded, never used again
const swap = await fetchSwap({ quote, userPublicKey: throwaway.address })
const unsigned = getTransactionDecoder().decode(getBase64Encoder().encode(swap.swapTransaction))
console.log(
  `Swap transaction: ${Object.keys(unsigned.signatures).length} signer(s), simulationError=${JSON.stringify(swap.simulationError)}`,
)
assert.deepEqual(
  Object.keys(unsigned.signatures),
  [throwaway.address],
  'the session key must be the only required signer',
)

const signed = await partiallySignTransaction([throwaway.keyPair], unsigned)
const signature = signed.signatures[throwaway.address]
assert.equal(signature?.length, 64, 'the signer produced a 64-byte signature')
const valid = await crypto.subtle.verify('Ed25519', throwaway.keyPair.publicKey, signature, signed.messageBytes)
assert.equal(valid, true, 'the signature verifies against the transaction message')
const wire = getBase64EncodedWireTransaction(signed)
console.log(`Signed and encoded OK: ${Buffer.from(wire, 'base64').length} bytes, signature verifies. Nothing was sent.`)
console.log('dry-run-swap: all checks passed')
