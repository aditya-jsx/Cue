// Run: node scripts/check-refresh-blockhash.mjs
import assert from 'node:assert/strict'

import {
  address,
  appendTransactionMessageInstruction,
  compileTransaction,
  createTransactionMessage,
  getCompiledTransactionMessageDecoder,
  pipe,
  setTransactionMessageFeePayer,
  setTransactionMessageLifetimeUsingBlockhash,
} from '@solana/kit'

import { getTransferSolInstruction } from '../src/features/wallet/util/get-transfer-sol-instruction.ts'
import { refreshBlockhash } from '../src/features/wallet/util/refresh-blockhash.ts'

const payer = address('EJj7PyVa15YxwyHFxjsFXkhVypoJy7QBg6Y6vT9RhKBi')
const to = address('BWGt3Yg3pKVLTJbaufw7xNzMesgsUAKTwVHRnsYg6bzv')
const OLD = 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' // any valid 32-byte base58 string works as a blockhash
const NEW = '11111111111111111111111111111111'

const original = compileTransaction(
  pipe(
    createTransactionMessage({ version: 0 }),
    (m) => setTransactionMessageFeePayer(payer, m),
    (m) => setTransactionMessageLifetimeUsingBlockhash({ blockhash: OLD, lastValidBlockHeight: 1n }, m),
    (m) =>
      appendTransactionMessageInstruction(
        getTransferSolInstruction({ amount: 2_000_000_000n, destination: to, source: payer }),
        m,
      ),
  ),
)

const rpc = {
  getLatestBlockhash: () => ({ send: async () => ({ value: { blockhash: NEW, lastValidBlockHeight: 99n } }) }),
}
const [fresh] = await refreshBlockhash([original], rpc)

const decode = (tx) => getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
const a = decode(original)
const b = decode(fresh)

assert.equal(b.lifetimeToken, NEW, 'blockhash is replaced')
assert.notEqual(a.lifetimeToken, b.lifetimeToken)
assert.deepEqual(b.staticAccounts, a.staticAccounts, 'fee payer and accounts unchanged')
assert.deepEqual(b.instructions, a.instructions, 'transfer instruction unchanged')
assert.equal(Object.keys(fresh.signatures).length, 1, 'still one required signature')

// A rate-limited (429) RPC is retried, any other error is not.
let calls = 0
const flaky = {
  getLatestBlockhash: () => ({
    send: async () => {
      if (++calls <= 2) throw new Error('HTTP error (429): Too Many Requests')
      return { value: { blockhash: NEW, lastValidBlockHeight: 99n } }
    },
  }),
}
const [retried] = await refreshBlockhash([original], flaky)
assert.equal(calls, 3, 'retried twice after 429, succeeded on the third try')
assert.equal(decode(retried).lifetimeToken, NEW)
const broken = {
  getLatestBlockhash: () => ({
    send: async () => {
      throw new Error('HTTP error (500)')
    },
  }),
}
await assert.rejects(() => refreshBlockhash([original], broken), /500/)

console.log('refresh-blockhash: all checks passed')
