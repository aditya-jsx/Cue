// Run: node scripts/check-skr.mjs          (offline: name parsing + PDA derivation)
//      node scripts/check-skr.mjs --live   (also resolves names against mainnet)
import assert from 'node:assert/strict'

import { createSolanaRpc } from '@solana/kit'

import { normalizeTranscript, parseIntent } from '../src/features/cue/data-access/parse-intent.ts'
import { deriveNameAccount, resolveSkr, ROOT_ANS, skrLabel, skrNamesOf } from '../src/features/cue/data-access/skr.ts'

// Every wrong hash or seed order fails silently (an empty account looks like an unregistered name), so pin the root.
assert.equal(await deriveNameAccount('ANS'), ROOT_ANS)

assert.equal(skrLabel('alice.skr'), 'alice')
assert.equal(skrLabel('Alice.SKR'), 'alice')
assert.equal(skrLabel('alice dot skr'), 'alice')
assert.equal(skrLabel('Alice dot S K R'), 'alice')
assert.equal(skrLabel('alice-bob.skr.'), 'alice-bob')
assert.equal(skrLabel('Alex'), null)
assert.equal(skrLabel('BWGt3Yg3pKVLTJbaufw7xNzMesgsUAKTwVHRnsYg6bzv'), null)
assert.equal(skrLabel('a.b.skr'), null) // subdomains are a different derivation
assert.equal(skrLabel('.skr'), null)

// The offline parser (used when the assistant is unreachable) keeps the spoken name for skrLabel to read.
for (const said of ['send 0.01 SOL to alice dot skr', 'send 0.01 sol to alice.skr']) {
  const intent = parseIntent(normalizeTranscript(said))
  assert.equal(intent.intent, 'instant_send', said)
  assert.equal(skrLabel(intent.recipient), 'alice', said)
}

if (process.argv.includes('--live')) {
  const rpc = createSolanaRpc(process.env.MAINNET_RPC_URL ?? 'https://api.mainnet-beta.solana.com')
  for (const name of process.argv.slice(3).length ? process.argv.slice(3) : ['solanamobile', 'seeker', 'toly']) {
    const owner = await resolveSkr(rpc, name)
    console.log(`${name}.skr ->`, owner)
    if (owner) console.log('  reverse:', await skrNamesOf(rpc, owner).catch((e) => `failed: ${e.message}`))
  }
}
console.log('check-skr: all checks passed')
