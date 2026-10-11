import { type Intent, normalizeTranscript, parseIntent, WATCHABLE_TOKENS } from './parse-intent.ts'

const API_URL = process.env.EXPO_PUBLIC_CUE_API_URL
const CLIENT_TOKEN = process.env.EXPO_PUBLIC_CUE_CLIENT_TOKEN ?? ''
const TIMEOUT_MS = 10_000
const AUDIO_TIMEOUT_MS = 20_000 // hearing audio is slower than reading text, and may retry on a busy model

/** Whether the Gemini assistant is configured. Without it, voice falls back to Android's recognizer + local parser. */
export const assistantConfigured = Boolean(API_URL)

const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const str = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null)

/** What was understood of a command, even when incomplete — pre-fills the manual form behind "Edit details". */
export type Draft = {
  action?: 'alert_only' | 'pause_activity'
  amount?: number
  amount_usd?: number
  condition?: 'above' | 'below'
  intent: 'conditional_buy' | 'instant_send' | 'portfolio_guard'
  recipient?: string
  threshold_pct?: number
  threshold_usd?: number
  timeframe?: '1h' | '24h'
  token?: string
}

export function toDraft(raw: unknown): Draft | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  if (o.intent !== 'instant_send' && o.intent !== 'conditional_buy' && o.intent !== 'portfolio_guard') return null
  const pick = <T>(v: T | null) => v ?? undefined
  return {
    action: o.action === 'pause_activity' || o.action === 'alert_only' ? o.action : undefined,
    amount: pick(num(o.amount)),
    amount_usd: pick(num(o.amount_usd)),
    condition: o.condition === 'above' || o.condition === 'below' ? o.condition : undefined,
    intent: o.intent,
    recipient: pick(str(o.recipient)),
    threshold_pct: pick(num(o.threshold_pct)),
    threshold_usd: pick(num(o.threshold_usd)),
    timeframe: o.timeframe === '1h' || o.timeframe === '24h' ? o.timeframe : undefined,
    token: str(o.token)?.toUpperCase(),
  }
}

/** What the manual form can reopen pre-filled: only the three actions it has fields for. */
export const draftOf = (intent: Intent): Draft | null =>
  intent.intent === 'instant_send' || intent.intent === 'conditional_buy' || intent.intent === 'portfolio_guard'
    ? intent
    : null

/** The proxy's reply is external input: rebuild a well-formed Intent from it, or reject it. */
export function toIntent(raw: unknown): Intent | null {
  if (!raw || typeof raw !== 'object') return null
  const o = raw as Record<string, unknown>
  switch (o.intent) {
    case 'instant_send': {
      const amount = num(o.amount)
      const recipient = str(o.recipient)
      return amount && recipient
        ? { amount, intent: 'instant_send', recipient, token: str(o.token)?.toUpperCase() ?? 'SOL' }
        : null
    }
    case 'conditional_buy': {
      const amount_usd = num(o.amount_usd)
      const threshold_usd = num(o.threshold_usd)
      const token = str(o.token)?.toUpperCase()
      const condition = o.condition === 'above' || o.condition === 'below' ? o.condition : null
      return amount_usd && threshold_usd && token && condition
        ? { amount_usd, condition, intent: 'conditional_buy', threshold_usd, token }
        : null
    }
    case 'portfolio_guard': {
      const threshold_pct = num(o.threshold_pct)
      return threshold_pct
        ? {
            action: o.action === 'pause_activity' ? 'pause_activity' : 'alert_only',
            intent: 'portfolio_guard',
            threshold_pct,
            timeframe: o.timeframe === '1h' ? '1h' : '24h',
          }
        : null
    }
    case 'price_alert': {
      const threshold_usd = num(o.threshold_usd)
      const token = str(o.token)?.toUpperCase()
      if (!threshold_usd || !token) return null
      const condition = o.condition === 'above' || o.condition === 'below' ? o.condition : undefined
      return { condition, intent: 'price_alert', threshold_usd, token }
    }
    case 'wallet_question':
      return o.question === 'balance' || o.question === 'price' || o.question === 'rules'
        ? { intent: 'wallet_question', question: o.question, token: str(o.token)?.toUpperCase() }
        : null
    case 'unsupported':
      return { intent: 'unsupported', reason: str(o.reason) ?? "I can't do that yet." }
  }
  return null
}

// This install's id, sent so the server can rate-limit per device. The app registers where to read it from at
// startup, which keeps this file free of app imports so scripts/check-parse-intent.mjs can load it in plain Node.
let deviceId = () => ''
export const setDeviceIdSource = (source: () => string) => {
  deviceId = source
}

/** Today's free voice commands are used up (a product limit, not an outage): the app says so instead of falling back. */
export class QuotaReached extends Error {
  limit: number
  retryAfterSec: number
  constructor(limit: number, retryAfterSec: number) {
    super('quota')
    this.limit = limit
    this.retryAfterSec = retryAfterSec
  }
}

async function throwIfQuota(response: Response) {
  if (response.status !== 429) return
  const body = (await response.json().catch(() => null)) as {
    error?: unknown
    limit?: unknown
    retryAfterSec?: unknown
  } | null
  if (body?.error === 'quota') throw new QuotaReached(Number(body.limit) || 50, Number(body.retryAfterSec) || 0)
}

export const quotaMessage = (q: QuotaReached) => {
  const hours = Math.max(1, Math.ceil(q.retryAfterSec / 3600))
  return `You've used today's ${q.limit} free voice commands. More in about ${hours} hour${hours === 1 ? '' : 's'}; the buttons on Home still work.`
}

const requestHeaders = () => ({
  'content-type': 'application/json',
  'x-cue-client': CLIENT_TOKEN,
  'x-cue-device': deviceId(),
})

/**
 * The understanding layer: Claude (via Cue's proxy) reads the raw transcript with the user's contacts as context and
 * returns an intent. Offline, timed out, or unconfigured, the local parser takes over so the app never goes dead.
 */
export async function understand(
  transcript: string,
  contacts: string[],
): Promise<{ draft: Draft | null; intent: Intent }> {
  const local = () => {
    const intent = parseIntent(normalizeTranscript(transcript))
    return { draft: draftOf(intent), intent }
  }
  if (!API_URL) return local()

  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS)
  try {
    const response = await fetch(`${API_URL}/api/parse-intent`, {
      // Cue's deterministic cleanup first (e.g. "send to sold" -> "send 2 SOL"), with the raw words as a hint.
      body: JSON.stringify({
        contacts,
        heard: transcript,
        text: normalizeTranscript(transcript),
        tokens: WATCHABLE_TOKENS,
      }),
      headers: requestHeaders(),
      method: 'POST',
      signal: abort.signal,
    })
    await throwIfQuota(response)
    if (!response.ok) throw new Error(`parse-intent ${response.status}`)
    const body = (await response.json()) as { draft?: unknown }
    const intent = toIntent(body)
    if (!intent) throw new Error('parse-intent returned an unusable intent')
    return { draft: intent.intent === 'unsupported' ? toDraft(body.draft) : draftOf(intent), intent }
  } catch (error) {
    if (error instanceof QuotaReached) throw error
    console.warn('[CueUnderstand] falling back to the local parser:', error)
    return local()
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Sends a recorded clip to the assistant, which hears it and returns what was said plus the intent. Returns null when
 * the assistant can't be reached, so the caller can fall back to Android's recognizer instead of leaving voice dead.
 */
export async function understandAudio(
  wavBase64: string,
  contacts: string[],
): Promise<{ draft: Draft | null; intent: Intent; transcript: string } | null> {
  if (!API_URL) return null
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), AUDIO_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_URL}/api/parse-intent`, {
      body: JSON.stringify({ audio: wavBase64, contacts, mimeType: 'audio/wav', tokens: WATCHABLE_TOKENS }),
      headers: requestHeaders(),
      method: 'POST',
      signal: abort.signal,
    })
    await throwIfQuota(response)
    if (!response.ok) throw new Error(`parse-intent ${response.status}`)
    const body = (await response.json()) as { draft?: unknown; transcript?: unknown }
    const intent = toIntent(body)
    if (!intent) throw new Error('parse-intent returned an unusable intent')
    return {
      draft: intent.intent === 'unsupported' ? toDraft(body.draft) : draftOf(intent),
      intent,
      transcript: typeof body.transcript === 'string' ? body.transcript.trim() : '',
    }
  } catch (error) {
    if (error instanceof QuotaReached) throw error
    console.warn('[CueUnderstand] audio request failed:', error)
    return null
  } finally {
    clearTimeout(timer)
  }
}

/** The user's spoken answer to "approve or decline?", as the assistant heard it. Null when it can't be reached. */
export async function understandReply(
  wavBase64: string,
): Promise<{ answer: 'approve' | 'decline' | 'unclear'; transcript: string } | null> {
  if (!API_URL) return null
  const abort = new AbortController()
  const timer = setTimeout(() => abort.abort(), AUDIO_TIMEOUT_MS)
  try {
    const response = await fetch(`${API_URL}/api/parse-intent`, {
      body: JSON.stringify({ audio: wavBase64, mimeType: 'audio/wav', mode: 'reply' }),
      headers: requestHeaders(),
      method: 'POST',
      signal: abort.signal,
    })
    await throwIfQuota(response)
    if (!response.ok) throw new Error(`parse-intent ${response.status}`)
    const body = (await response.json()) as { answer?: unknown; transcript?: unknown }
    return {
      answer: body.answer === 'approve' || body.answer === 'decline' ? body.answer : 'unclear',
      transcript: typeof body.transcript === 'string' ? body.transcript.trim() : '',
    }
  } catch (error) {
    console.warn('[CueUnderstand] reply request failed:', error)
    return null
  } finally {
    clearTimeout(timer)
  }
}
