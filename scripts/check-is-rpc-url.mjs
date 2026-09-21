// Run: node scripts/check-is-rpc-url.mjs
import assert from 'node:assert/strict'

import { isRpcUrl } from '../src/features/cluster/data-access/is-rpc-url.ts'

for (const ok of [
  '',
  'https://api.devnet.solana.com',
  'http://localhost:8899',
  'https://devnet.helius-rpc.com/?api-key=abc',
])
  assert.ok(isRpcUrl(ok), ok)

// The crash case: only the API key was pasted.
for (const bad of [
  '00000000-1111-2222-3333-444444444444',
  'devnet.helius-rpc.com',
  'wss://x.io',
  'https://',
  'https:// x',
  'ftp://x.io',
])
  assert.ok(!isRpcUrl(bad), bad)

console.log('is-rpc-url: all checks passed')
