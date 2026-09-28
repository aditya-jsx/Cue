import { ApiError, GoogleGenAI } from '@google/genai'

// Turns a (often garbled) speech transcript into Cue's intent JSON. Only parses: the app re-validates every field
// and shows a confirm screen before anything executes, so this endpoint never touches funds or keys.

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY }) // set in the Vercel project env

const SYSTEM = `You turn a spoken wallet command into Cue's intent JSON.

The command comes from on-device speech recognition and is often garbled. Recover what the user most plausibly meant: numbers can arrive as words or homophones ("to"/"too" for 2, "for" for 4, "won" for 1), "SOL" can arrive as "sold", "soul" or "sole", and short names lose letters ("LX" for Alex).

The command has already had Cue's own cleanup applied; the raw recognition, when shown, is only a hint.

Cue can do exactly three things:
- instant_send: send SOL right now. Fill amount (in SOL), token ("SOL") and recipient.
- conditional_buy: buy a token when its price crosses a threshold. Fill amount_usd, token, condition ("below" or "above") and threshold_usd in dollars ("85 cents" is 0.85).
- portfolio_guard: watch for a drop in the user's portfolio. Fill threshold_pct, timeframe ("1h", or "24h" for "today"/"a day"/unspecified) and action ("pause_activity" when they say pause, stop or freeze; otherwise "alert_only").
Anything else is "unsupported", with a short, friendly reason written to the user.

For the recipient: if the spoken name plausibly matches one of the user's contacts, return that contact's exact name. Return a wallet address unchanged. Otherwise return the name as heard.
Never invent an amount, token or price the user didn't say. If you can tell which action they want but a value is missing or unintelligible, still set intent to that action, fill in what you did understand, leave the rest null, and put a short question for the missing part in reason.
Set every field that doesn't apply to null.`

const nullable = (schema: object) => ({ anyOf: [schema, { type: 'null' }] })

const SCHEMA = {
  additionalProperties: false,
  properties: {
    action: nullable({ enum: ['alert_only', 'pause_activity'], type: 'string' }),
    amount: nullable({ type: 'number' }),
    amount_usd: nullable({ type: 'number' }),
    condition: nullable({ enum: ['above', 'below'], type: 'string' }),
    intent: { enum: ['instant_send', 'conditional_buy', 'portfolio_guard', 'unsupported'], type: 'string' },
    reason: nullable({ type: 'string' }),
    recipient: nullable({ type: 'string' }),
    threshold_pct: nullable({ type: 'number' }),
    threshold_usd: nullable({ type: 'number' }),
    timeframe: nullable({ enum: ['1h', '24h'], type: 'string' }),
    token: nullable({ type: 'string' }),
  },
  required: [
    'action',
    'amount',
    'amount_usd',
    'condition',
    'intent',
    'reason',
    'recipient',
    'threshold_pct',
    'threshold_usd',
    'timeframe',
    'token',
  ],
  type: 'object',
}

const UNSUPPORTED = (reason: string) => Response.json({ draft: null, intent: 'unsupported', reason })

type Raw = Record<string, unknown> & { intent?: string; reason?: string | null }

const LABELS: Record<string, string> = {
  amount: 'amount',
  amount_usd: 'amount',
  condition: 'direction',
  recipient: 'who to send it to',
  threshold_pct: 'percentage',
  threshold_usd: 'price',
  token: 'token',
}
const REQUIRED: Record<string, string[]> = {
  conditional_buy: ['amount_usd', 'token', 'threshold_usd', 'condition'],
  instant_send: ['amount', 'recipient'],
  portfolio_guard: ['threshold_pct'],
}

/**
 * Gemini's schema allows half-filled answers ("a buy, below $0.30, token unknown"). Cue only takes complete intents,
 * so this turns every answer into exactly one of: a complete intent, or `unsupported` with a question plus a `draft`
 * of what was understood (so the app can open a pre-filled form instead of dead-ending).
 */
function toCueIntent(raw: Raw) {
  const fields = Object.fromEntries(Object.entries(raw).filter(([k, v]) => v !== null && k !== 'reason'))
  const required = raw.intent ? REQUIRED[raw.intent] : undefined
  if (!required) return { draft: null, intent: 'unsupported', reason: raw.reason || "I can't do that yet." }

  const missing = required.filter((k) => fields[k] === undefined)
  if (missing.length) {
    const what = [...new Set(missing.map((k) => LABELS[k]))].join(' and ')
    return { draft: fields, intent: 'unsupported', reason: raw.reason || `I didn't catch the ${what}.` }
  }
  if (raw.intent === 'instant_send') return { ...fields, token: String(fields.token ?? 'SOL').toUpperCase() }
  if (raw.intent === 'conditional_buy') return { ...fields, token: String(fields.token).toUpperCase() }
  return { action: 'alert_only', timeframe: '24h', ...fields }
}

const strings = (value: unknown, max: number) =>
  Array.isArray(value) ? value.filter((v): v is string => typeof v === 'string').map((v) => v.slice(0, 64)).slice(0, max) : []

export async function POST(request: Request): Promise<Response> {
  // ponytail: a shared token only raises the bar (it ships inside the APK); add per-device rate limiting before a
  // public launch so nobody can run up the Gemini bill through this endpoint.
  const token = process.env.CUE_CLIENT_TOKEN
  if (token && request.headers.get('x-cue-client') !== token) return new Response('Forbidden', { status: 403 })

  const body = (await request.json().catch(() => null)) as {
    contacts?: unknown
    heard?: unknown
    text?: unknown
    tokens?: unknown
  } | null
  const text = typeof body?.text === 'string' ? body.text.trim().slice(0, 500) : ''
  if (!text) return new Response('Missing text', { status: 400 })
  const contacts = strings(body?.contacts, 50)
  const tokens = strings(body?.tokens, 20)
  const heard = typeof body?.heard === 'string' ? body.heard.trim().slice(0, 500) : ''

  try {
    const response = await ai.models.generateContent({
      config: {
        responseJsonSchema: SCHEMA,
        responseMimeType: 'application/json',
        systemInstruction: SYSTEM,
        temperature: 0,
        thinkingConfig: { thinkingBudget: 0 }, // a voice command needs an answer in ~1s, not reasoning
      },
      contents: `Contacts: ${contacts.join(', ') || 'none'}\nTokens Cue can buy: ${tokens.join(', ') || 'SOL'}\nCommand: ${JSON.stringify(text)}${heard && heard !== text ? `\nRaw speech recognition: ${JSON.stringify(heard)}` : ''}`,
      model: 'gemini-2.5-flash',
    })
    const finish = response.candidates?.[0]?.finishReason
    if (!response.text || finish !== 'STOP') {
      return UNSUPPORTED("I couldn't work that out. Try saying it another way.")
    }
    return Response.json(toCueIntent(JSON.parse(response.text) as Raw))
  } catch (error) {
    if (error instanceof ApiError) {
      console.error('[parse-intent] Gemini error', error.status, error.message)
      return new Response(`Upstream ${error.status}: ${error.message}`, { status: error.status === 429 ? 429 : 502 })
    }
    throw error
  }
}
