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

/**
 * Free voice commands per install per day (UTC). Answers to "approve or decline?" don't count. FREE_COMMANDS_PER_DAY in
 * the environment overrides it (e.g. raised for a demo day) without a code change.
 */
export const FREE_COMMANDS_PER_DAY = Number(process.env.FREE_COMMANDS_PER_DAY) || 60

/**
 * The limits. The per-IP ones are looser (several people share an address) and catch a forged device id. `reply`
 * requests (a one-word approve/decline) still count against the abuse limits but not the free daily quota.
 */
export const rulesFor = (dailyBudget: number, reply = false): (LimitRule & { by: string })[] => [
  { by: 'device', max: 20, name: 'device-minute', windowSec: 60 },
  ...(reply ? [] : [{ by: 'device', max: FREE_COMMANDS_PER_DAY, name: 'device-quota', windowSec: 86_400 }]),
  { by: 'ip', max: 120, name: 'ip-minute', windowSec: 60 },
  { by: 'ip', max: 2000, name: 'ip-day', windowSec: 86_400 },
  { by: 'global', max: dailyBudget, name: 'budget-day', windowSec: 86_400 }, // a ceiling on the daily bill
]

/**
 * The counter store every endpoint shares: Upstash when it is configured (Vercel's Upstash integration sets the KV_*
 * names), else this instance's memory. `limit` falls back to memory if Upstash is unreachable, so an outage there
 * loosens the limits instead of taking the endpoint down.
 */
const upstashUrl = process.env.UPSTASH_REDIS_REST_URL ?? process.env.KV_REST_API_URL
const upstashToken = process.env.UPSTASH_REDIS_REST_TOKEN ?? process.env.KV_REST_API_TOKEN
const memory = memoryStore()
const shared = upstashUrl && upstashToken ? upstashStore(upstashUrl, upstashToken) : memory
export const countersBackend = shared === memory ? 'memory' : 'upstash'

export function limit(identity: Record<string, string | undefined>, rules: (LimitRule & { by: string })[]) {
  const ids = Object.fromEntries(Object.entries(identity).filter(([, v]) => v)) as Record<string, string>
  return checkLimits(shared, ids, rules).catch((error) => {
    console.warn('[rate-limit] counter store failed, counting in memory', String(error))
    return checkLimits(memory, ids, rules)
  })
}

/** RPC proxy limits: generous for one phone, but a hard daily ceiling keeps the Helius bill inside the free tier. */
export const rpcRules: (LimitRule & { by: string })[] = [
  { by: 'device', max: 240, name: 'rpc-device-minute', windowSec: 60 },
  { by: 'device', max: 5000, name: 'rpc-device-day', windowSec: 86_400 },
  { by: 'ip', max: 1200, name: 'rpc-ip-minute', windowSec: 60 },
  { by: 'global', max: 30_000, name: 'rpc-budget-day', windowSec: 86_400 },
]
