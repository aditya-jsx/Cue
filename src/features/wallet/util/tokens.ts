import { address } from '@solana/kit'

import type { Symbol } from '@/features/prices/data-access/price-store'

/** Tokens Cue can buy for real (mainnet). SOL is what it spends, so it isn't listed. */
export const BUYABLE_TOKENS: Partial<Record<Symbol, { decimals: number; mint: ReturnType<typeof address> }>> = {
  JUP: { decimals: 6, mint: address('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN') },
}
