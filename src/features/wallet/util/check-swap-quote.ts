// The last line of defence before Cue spends money on a swap: is the quote close to the market price, and cheap
// enough to trade? Returns why to refuse, or null when it is fine. Pure, so it is tested without a network.

export interface SwapQuote {
  inAmount: string
  outAmount: string
  priceImpactPct: string // a fraction: "0.0388" is 3.88%
  slippageBps: number
}

const MAX_BELOW_MARKET = 0.03 // refuse a quote more than 3% worse than the Pyth price
const MAX_PRICE_IMPACT = 0.01 // refuse a trade that moves the price more than 1%
const MAX_SLIPPAGE_BPS = 100 // never accept more than 1% slippage

export function checkSwapQuote({
  amountLamports,
  quote,
  solUsd,
  tokenDecimals,
  tokenUsd,
}: {
  amountLamports: bigint
  quote: SwapQuote
  solUsd: number
  tokenDecimals: number
  tokenUsd: number
}): string | null {
  if (BigInt(quote.inAmount) !== amountLamports) return 'The quote is for a different amount than the rule.'
  if (!(solUsd > 0) || !(tokenUsd > 0)) return 'There is no market price to check the quote against.'
  if (quote.slippageBps > MAX_SLIPPAGE_BPS) return 'The quote allows more slippage than Cue accepts.'

  const impact = Number(quote.priceImpactPct)
  if (!Number.isFinite(impact)) return 'The quote has no price impact figure.'
  if (impact > MAX_PRICE_IMPACT)
    return `The trade would move the price ${(impact * 100).toFixed(1)}%, more than Cue allows.`

  // What the market price says the SOL is worth, in tokens, against what Jupiter will actually deliver.
  const expected = ((Number(amountLamports) / 1e9) * solUsd) / tokenUsd
  const offered = Number(quote.outAmount) / 10 ** tokenDecimals
  if (!(offered > 0)) return 'The quote returns nothing.'
  if (offered < expected * (1 - MAX_BELOW_MARKET)) {
    return `Jupiter's price is ${((1 - offered / expected) * 100).toFixed(1)}% worse than the market price, so Cue won't buy.`
  }
  return null
}
