// Run: node scripts/check-wallet-errors.mjs
import assert from 'node:assert/strict'

import { describeWalletError } from '../src/features/wallet/util/describe-wallet-error.ts'

// Mobile Wallet Adapter protocol errors carry numeric codes; adapter errors carry string codes.
const declinedConnect = describeWalletError(Object.assign(new Error('x'), { code: -1 }))
assert.match(declinedConnect, /declined the connection/)
const declinedSign = describeWalletError(Object.assign(new Error('x'), { code: -3 }))
assert.match(declinedSign, /declined the request/)
assert.match(declinedSign, /Nothing was sent/) // the user must know no money moved
assert.match(describeWalletError({ code: -4 }), /Nothing was sent/)
assert.match(describeWalletError({ code: 'ERROR_WALLET_NOT_FOUND' }), /Install Phantom or Solflare/)
assert.match(describeWalletError({ code: 'ERROR_SESSION_TIMEOUT' }), /didn't respond in time/)
assert.match(describeWalletError({ code: 'ERROR_SESSION_CLOSED' }), /closed before you answered/)
assert.match(describeWalletError({ code: 'ERROR_ASSOCIATION_CANCELLED' }), /closed before you answered/)

// Offline / DNS failures read the same however the platform words them, and never mention an emulator.
for (const message of [
  'java.net.UnknownHostException: Unable to resolve host "api.devnet.solana.com"',
  'Network request failed',
  'TypeError: Failed to fetch',
]) {
  const text = describeWalletError(new Error(message))
  assert.match(text, /Can't reach the network/)
  assert.doesNotMatch(text, /emulator/i)
}

// Anything it doesn't recognise falls through untouched, so real error text (like "Insufficient funds…") survives.
assert.equal(describeWalletError(new Error('Insufficient funds. Current balance is 0.0010 SOL')), null)
assert.equal(describeWalletError({ code: 42 }), null)
assert.equal(describeWalletError(undefined), null)
assert.equal(describeWalletError('boom'), null)

console.log('wallet-errors: all checks passed')
