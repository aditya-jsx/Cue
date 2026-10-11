import { address } from '@solana/kit'

import type { Symbol } from '@/features/prices/data-access/price-store'

/** Tokens Cue can buy for real (mainnet). SOL is what it spends, so it isn't listed. */
export const BUYABLE_TOKENS: Partial<Record<Symbol, { decimals: number; mint: ReturnType<typeof address> }>> = {
  JUP: { decimals: 6, mint: address('JUPyiwrYJFskUPiHa7hkeR8VUtAeFoSYbKedZNsDvCN') },
  SKR: { decimals: 6, mint: address('SKRbvo6Gf7GondiT3BbTfuRDPqLWei4j2Qy2NPGZhW3') },
}

/**
 * Cue's fee on a buy: 0.5%, taken by Jupiter in the token bought into the treasury's account for it, within the swap
 * itself. No fee on sends, alerts, guards or questions. Off when no treasury is set.
 */
export const CUE_FEE_BPS = 50
export const CUE_TREASURY = process.env.EXPO_PUBLIC_CUE_TREASURY ? address(process.env.EXPO_PUBLIC_CUE_TREASURY) : null
