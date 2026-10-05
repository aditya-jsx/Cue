// How old a price may be before Cue refuses to act on it. Measured from Pyth's sponsored on-chain feeds: devnet
// updates about every 5 minutes, mainnet about every 45-60 seconds. The limits leave room for normal gaps but still
// catch a stalled feed, so a buy or guard never fires on old data.
const MAINNET_MAX_PRICE_AGE_MS = 3 * 60_000
const OTHER_MAX_PRICE_AGE_MS = 10 * 60_000

export const maxPriceAgeMs = (clusterId: string): number =>
  clusterId === 'solana:mainnet' ? MAINNET_MAX_PRICE_AGE_MS : OTHER_MAX_PRICE_AGE_MS

export const isPriceFresh = (publishTimeMs: number, nowMs: number, maxAgeMs: number): boolean =>
  nowMs - publishTimeMs <= maxAgeMs
