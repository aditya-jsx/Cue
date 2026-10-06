// Per-device and per-IP rate limits for the parser, so nobody can run up the Gemini bill through the public endpoint.
// Fixed windows over a counter store: Upstash Redis when it is configured (correct across Vercel's many instances),
// otherwise memory (best effort: each instance counts alone, so limits are looser than they look).

export interface LimitRule {
  max: number
  name: string
  windowSec: number
}

export type Verdict = { ok: true } | { ok: false; retryAfterSec: number; rule: string }

/** Adds one to `key` and returns the new count. The key expires `windowSec` after its first hit. */
export interface CounterStore {
  incr(key: string, windowSec: number): Promise<number>
}

export function memoryStore(now: () => number = Date.now): CounterStore {
  const counts = new Map<string, { count: number; resetAt: number }>()
  return {
    async incr(key, windowSec) {
      const t = now()
      if (counts.size > 5000) for (const [k, v] of counts) if (v.resetAt <= t) counts.delete(k)
      const hit = counts.get(key)
      if (!hit || hit.resetAt <= t) {
        counts.set(key, { count: 1, resetAt: t + windowSec * 1000 })
        return 1
      }
      return ++hit.count
    },
  }
}

export function upstashStore(url: string, token: string, fetchFn: typeof fetch = fetch): CounterStore {
  return {
    async incr(key, windowSec) {
      const response = await fetchFn(`${url}/pipeline`, {
        body: JSON.stringify([
          ['INCR', key],
          ['EXPIRE', key, windowSec, 'NX'], // only the first hit starts the clock
        ]),
        headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
        method: 'POST',
        signal: AbortSignal.timeout(2000),
      })
      if (!response.ok) throw new Error(`Upstash answered ${response.status}`)
      const [incr] = (await response.json()) as { result: number }[]
      return Number(incr.result)
    },
  }
}

/** Counts one request against every rule and says whether it may go ahead. A request over any rule is refused. */
export async function checkLimits(
  store: CounterStore,
  identity: Record<string, string>, // which counter each rule uses, e.g. { device: 'abc', ip: '1.2.3.4' }
  rules: (LimitRule & { by: string })[],
  nowMs: number = Date.now(),
): Promise<Verdict> {
  const nowSec = Math.floor(nowMs / 1000)
  for (const rule of rules) {
    const id = identity[rule.by]
    if (!id) continue
    const window = Math.floor(nowSec / rule.windowSec)
    const count = await store.incr(`cue:${rule.name}:${id}:${window}`, rule.windowSec)
    if (count > rule.max)
      return { ok: false, retryAfterSec: rule.windowSec - (nowSec % rule.windowSec), rule: rule.name }
  }
  return { ok: true }
}

const DEVICE_ID = /^[A-Za-z0-9_-]{16,64}$/

/** Who is asking: the install's own id (when it sent a sane one) and the network address it came from. */
export function identify(headers: Headers): { device?: string; global: string; ip?: string } {
  const device = headers.get('x-cue-device') ?? ''
  const ip = (headers.get('x-forwarded-for') ?? headers.get('x-real-ip') ?? '').split(',')[0].trim()
  return { device: DEVICE_ID.test(device) ? device : undefined, global: 'all', ip: ip || undefined }
}

/** The limits. The per-IP ones are looser (several people share an address) and catch a forged device id. */
export const rulesFor = (dailyBudget: number): (LimitRule & { by: string })[] => [
  { by: 'device', max: 20, name: 'device-minute', windowSec: 60 },
  { by: 'device', max: 400, name: 'device-day', windowSec: 86_400 },
  { by: 'ip', max: 120, name: 'ip-minute', windowSec: 60 },
  { by: 'ip', max: 2000, name: 'ip-day', windowSec: 86_400 },
  { by: 'global', max: dailyBudget, name: 'budget-day', windowSec: 86_400 }, // a ceiling on the daily bill
]
