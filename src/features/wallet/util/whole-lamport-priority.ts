import { getCompiledTransactionMessageDecoder, type Transaction } from '@solana/kit'

const COMPUTE_BUDGET = 'ComputeBudget111111111111111111111111111111'
const MICRO_LAMPORTS = 1_000_000n

/**
 * Phantom crashes drawing a transaction whose priority fee isn't a whole number of lamports ("RangeError: number is not
 * integral"), and Jupiter's dynamic price (e.g. 4779 µlamports x 114617 CU = 547.75 lamports) usually isn't. Rounds the
 * price up to a whole lamport per compute unit, so the fee is whole; costs about a cent at most. Nothing else changes,
 * and the transaction isn't signed yet, so editing it is safe.
 */
export function withWholeLamportPriority(tx: Transaction): Transaction {
  // Jupiter builds version-0 messages, which carry their instructions in compiled form.
  const message = getCompiledTransactionMessageDecoder().decode(tx.messageBytes) as unknown as {
    instructions: { data?: Uint8Array; programAddressIndex: number }[]
    staticAccounts: string[]
  }
  const setPrice = message.instructions.find(
    (ix) => message.staticAccounts[ix.programAddressIndex] === COMPUTE_BUDGET && ix.data?.[0] === 3,
  )
  if (!setPrice?.data) return tx
  const old = setPrice.data.slice(0, 9) // [3, price u64 little-endian]
  const price = new DataView(old.buffer, old.byteOffset, 9).getBigUint64(1, true)
  const rounded = price % MICRO_LAMPORTS === 0n ? price : (price / MICRO_LAMPORTS + 1n) * MICRO_LAMPORTS
  if (rounded === price) return tx
  const replacement = new Uint8Array(9)
  replacement[0] = 3
  new DataView(replacement.buffer).setBigUint64(1, rounded, true)
  const bytes = new Uint8Array(tx.messageBytes)
  for (let i = 0; i + 9 <= bytes.length; i++) {
    if (Array.from(old).every((b, j) => bytes[i + j] === b)) {
      bytes.set(replacement, i)
      return { ...tx, messageBytes: bytes as unknown as Transaction['messageBytes'] }
    }
  }
  return tx
}
