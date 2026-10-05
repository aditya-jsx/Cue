// Jupiter's swap API. No key is needed for the lite endpoint. Kept free of app imports so it runs in node scripts too.
const BASE = 'https://lite-api.jup.ag/swap/v1'
const TIMEOUT_MS = 15_000

export interface JupiterQuote {
  inAmount: string
  inputMint: string
  outAmount: string
  outputMint: string
  priceImpactPct: string
  slippageBps: number
  [key: string]: unknown
}

export interface JupiterSwap {
  lastValidBlockHeight: number
  simulationError: unknown
  swapTransaction: string // base64, a ready-to-sign version-0 transaction with its address-lookup tables
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: abort.signal })
    if (!response.ok) throw new Error(`Jupiter answered ${response.status}: ${(await response.text()).slice(0, 160)}`)
    return (await response.json()) as T
  } finally {
    clearTimeout(timer)
  }
}

export function fetchQuote(p: { amount: bigint; inputMint: string; outputMint: string; slippageBps: number }) {
  const q = new URLSearchParams({
    amount: p.amount.toString(),
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    restrictIntermediateTokens: 'true', // only well-traded hops, so a thin pool can't sit in the middle of the route
    slippageBps: String(p.slippageBps),
  })
  return request<JupiterQuote>(`${BASE}/quote?${q}`)
}

/** Builds the swap for `userPublicKey` to sign and send. It spends from the user's own token account (no wrapping). */
export function fetchSwap(p: { quote: JupiterQuote; userPublicKey: string }) {
  return request<JupiterSwap>(`${BASE}/swap`, {
    body: JSON.stringify({
      dynamicComputeUnitLimit: true,
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 100_000, priorityLevel: 'high' } },
      quoteResponse: p.quote,
      userPublicKey: p.userPublicKey,
      wrapAndUnwrapSol: false,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}
