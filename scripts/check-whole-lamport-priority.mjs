// Run: node scripts/check-whole-lamport-priority.mjs   (fetches a real Jupiter swap; nothing is signed or sent)
import assert from 'node:assert/strict'

import { getBase64Encoder, getCompiledTransactionMessageDecoder, getTransactionDecoder } from '@solana/kit'

import { fetchQuote, fetchSwap } from '../src/features/wallet/util/jupiter.ts'
import { withWholeLamportPriority } from '../src/features/wallet/util/whole-lamport-priority.ts'

const JUP = 'JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN'
const SOL = 'So11111111111111111111111111111111111111112'
const owner = 'EJj7PyVa15YxwyHFxjsFXkhVypoJy7QBg6Y6vT9RhKBi'

function budget(tx) {
  const msg = getCompiledTransactionMessageDecoder().decode(tx.messageBytes)
  let limit = 0
  let price = 0n
  for (const ix of msg.instructions) {
    if (msg.staticAccounts[ix.programAddressIndex] !== 'ComputeBudget111111111111111111111111111111') continue
    const view = new DataView(ix.data.buffer, ix.data.byteOffset)
    if (ix.data[0] === 2) limit = view.getUint32(1, true)
    if (ix.data[0] === 3) price = view.getBigUint64(1, true)
  }
  return { limit, msg, price }
}

const quote = await fetchQuote({ amount: 1_000_000n, inputMint: JUP, outputMint: SOL, slippageBps: 50 })
const swap = await fetchSwap({ quote, userPublicKey: owner, wrapAndUnwrapSol: true })
const tx = getTransactionDecoder().decode(getBase64Encoder().encode(swap.swapTransaction))
const before = budget(tx)
const after = budget(withWholeLamportPriority(tx))

assert.equal(after.price % 1_000_000n, 0n, 'whole lamports per compute unit')
assert.ok(after.price >= before.price, 'never lowers the priority')
assert.equal((after.price * BigInt(after.limit)) % 1_000_000n, 0n, 'the priority fee is a whole number of lamports')
assert.equal(after.limit, before.limit)
assert.equal(after.msg.instructions.length, before.msg.instructions.length, 'nothing else changed')
assert.deepEqual(after.msg.staticAccounts, before.msg.staticAccounts)
console.log(
  `price ${before.price} -> ${after.price} µlamports/CU, fee ${(Number(after.price) * after.limit) / 1e6} lamports`,
)
console.log('whole-lamport-priority: all checks passed')
