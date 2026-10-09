// How old a price may be before Cue refuses to act on it. Pyth's sponsored on-chain feeds publish when the price moves
// enough or at a slow heartbeat of up to about an hour, so a quiet feed can legitimately sit unchanged for a long time
// on devnet (JUP was seen 11 minutes stale while SOL was 3). Mainnet feeds were measured updating about every minute,
// so a 3 minute limit there catches a stalled feed without tripping on normal gaps. Devnet moves no real money, so
// its limit only has to exceed the heartbeat, so a rule isn't left idle for no reason.
const MAINNET_MAX_PRICE_AGE_MS = 3 * 60_000
const OTHER_MAX_PRICE_AGE_MS = 75 * 60_000

export const maxPriceAgeMs = (clusterId: string): number =>
  clusterId === 'solana:mainnet' ? MAINNET_MAX_PRICE_AGE_MS : OTHER_MAX_PRICE_AGE_MS

export const isPriceFresh = (publishTimeMs: number, nowMs: number, maxAgeMs: number): boolean =>
  nowMs - publishTimeMs <= maxAgeMs
