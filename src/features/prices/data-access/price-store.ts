import { atom } from 'nanostores'

export type Symbol = 'JUP' | 'SOL'

// Pyth's sponsored on-chain "price feed accounts" (shard 0), continuously updated for free by Pyth's own
// keeper on both mainnet and devnet — no Hermes, no API key. See https://docs.pyth.network/price-feeds/core/push-feeds/solana
export const PRICE_FEED_ACCOUNTS: Record<Symbol, string> = {
  JUP: '7dbob1psH1iZBS7qPsm3Kwbf5DzSXK8Jyg31CTgTnxH5',
  SOL: '7UVimffxr9ow1uXYxsr4LHAcV58mLzhmwaeKvJ1pjLiE',
}

export type PricePoint = { publishTimeMs: number; usd: number }

// Headless tasks and the foreground UI share this JS runtime (confirmed via the CueSpike heartbeat all session:
// its logs kept appearing across backgrounding without a restart), so a plain atom is enough — no IPC needed.
export const $prices = atom<Partial<Record<Symbol, PricePoint>>>({})

export function setPrice(symbol: Symbol, point: PricePoint) {
  $prices.set({ ...$prices.get(), [symbol]: point })
}
