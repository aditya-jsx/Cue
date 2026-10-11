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

async function attempt<T>(url: string, init?: RequestInit): Promise<{ retry: boolean; value?: T; error?: Error }> {
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(url, { ...init, signal: abort.signal })
    if (response.ok) return { retry: false, value: (await response.json()) as T }
    // Busy or briefly down (it answers 503 with an HTML page): worth another go. Anything else won't change.
    const busy = response.status === 429 || response.status >= 500
    const detail = busy ? 'is busy or briefly down' : `refused it: ${(await response.text()).slice(0, 120)}`
    return { error: new Error(`Jupiter ${detail} (${response.status}).`), retry: busy }
  } catch (error) {
    return { error: error instanceof Error ? error : new Error(String(error)), retry: true }
  } finally {
    clearTimeout(timer)
  }
}

async function request<T>(url: string, init?: RequestInit): Promise<T> {
  let last: Error | undefined
  for (const waitMs of [0, 1000, 2500]) {
    if (waitMs) await new Promise((resolve) => setTimeout(resolve, waitMs))
    const result = await attempt<T>(url, init)
    if (result.value !== undefined) return result.value
    last = result.error
    if (!result.retry) break
  }
  throw last ?? new Error('Jupiter did not answer.')
}

export function fetchQuote(p: {
  amount: bigint
  inputMint: string
  outputMint: string
  platformFeeBps?: number // Cue's fee, collected in the input token into the account given to fetchSwap
  slippageBps: number
}) {
  const q = new URLSearchParams({
    amount: p.amount.toString(),
    inputMint: p.inputMint,
    outputMint: p.outputMint,
    restrictIntermediateTokens: 'true', // only well-traded hops, so a thin pool can't sit in the middle of the route
    slippageBps: String(p.slippageBps),
    ...(p.platformFeeBps ? { platformFeeBps: String(p.platformFeeBps) } : {}),
  })
  return request<JupiterQuote>(`${BASE}/quote?${q}`)
}

/** Builds the swap for `userPublicKey` to sign and send. It spends from the user's own token account (no wrapping). */
export function fetchSwap(p: { feeAccount?: string; quote: JupiterQuote; userPublicKey: string }) {
  return request<JupiterSwap>(`${BASE}/swap`, {
    body: JSON.stringify({
      dynamicComputeUnitLimit: true,
      ...(p.feeAccount ? { feeAccount: p.feeAccount } : {}),
      prioritizationFeeLamports: { priorityLevelWithMaxLamports: { maxLamports: 100_000, priorityLevel: 'high' } },
      quoteResponse: p.quote,
      userPublicKey: p.userPublicKey,
      wrapAndUnwrapSol: false,
    }),
    headers: { 'content-type': 'application/json' },
    method: 'POST',
  })
}
