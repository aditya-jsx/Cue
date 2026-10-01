// Local stand-in for the LLM parser. Emits exactly the schema in docs/brief.md.
// Erasable TS only (no enums, no imports) so scripts/check-parse-intent.mjs can run it directly under node.
export type Intent =
  | { amount: number; intent: 'instant_send'; recipient: string; token: string }
  | {
      amount_usd: number
      condition: 'above' | 'below'
      expires_at?: string
      intent: 'conditional_buy'
      threshold_usd: number
      token: string
    }
  | {
      action: 'alert_only' | 'pause_activity'
      intent: 'portfolio_guard'
      threshold_pct: number
      timeframe: '1h' | '24h'
    }
  | { intent: 'unsupported'; reason: string }

// Tokens Cue has a live price feed for, so it can actually watch them.
export const WATCHABLE_TOKENS = ['SOL', 'JUP']

const NOPE = "I can't do that yet."

const NUMBER_WORDS: Record<string, string> = {
  eight: '8',
  fifty: '50',
  five: '5',
  four: '4',
  hundred: '100',
  nine: '9',
  one: '1',
  seven: '7',
  six: '6',
  ten: '10',
  three: '3',
  twenty: '20',
  two: '2',
  zero: '0',
}
// What on-device STT writes for a spoken digit in the amount slot ("send two SOL" -> "send to SOL"). Only applied
// right after the verb, since these are ordinary words anywhere else in a sentence.
const AMOUNT_HOMOPHONES: Record<string, string> = { ...NUMBER_WORDS, ate: '8', for: '4', to: '2', too: '2', won: '1' }

/** Undoes the ways on-device speech recognition reliably mangles Cue's commands, before parsing. */
export function normalizeTranscript(text: string): string {
  return text
    .replace(/\b(sold|sole|soul|saul)\b/gi, 'SOL')
    .replace(/,(?!\d)/g, ' ') // "Send 2 SOL, to Alex"; keeps "1,000"
    .replace(/[.!?]+\s*$/, '') // dictation auto-punctuates short utterances: "...to Alex."
    .replace(/^(send|transfer)\s+([a-z]+)\b/i, (m, verb: string, w: string) => {
      const digit = AMOUNT_HOMOPHONES[w.toLowerCase()]
      return digit ? `${verb} ${digit}` : m
    })
    .replace(/\b([a-z]+)(\s+(?:dollars?|bucks|cents|percent|SOL)\b)/gi, (m, w: string, unit: string) => {
      const digit = NUMBER_WORDS[w.toLowerCase()]
      return digit ? `${digit}${unit}` : m
    })
    .replace(/\b(\d+(?:\.\d+)?)\s+(?:dollars?|bucks)\b/gi, '$$$1')
    .replace(/\b(\d+(?:\.\d+)?)\s*percent\b/gi, '$1%')
    .replace(/\s+/g, ' ')
    .trim()
}

export function parseIntent(text: string): Intent {
  const t = text.trim()

  const send = t.match(/^(?:send|transfer)\s+(\d*\.?\d+)\s*([a-z]+)?\s+to\s+(.+)$/i)
  if (send) {
    const amount = Number(send[1])
    const token = (send[2] ?? 'SOL').toUpperCase()
    if (!(amount > 0)) return { intent: 'unsupported', reason: 'The amount must be more than zero.' }
    if (token !== 'SOL') return { intent: 'unsupported', reason: `I can only send SOL for now, not ${token}.` }
    return { amount, intent: 'instant_send', recipient: send[3].trim(), token }
  }

  const buy = t.match(/^buy\s+\$?(\d*\.?\d+)\s+(?:of|worth of)\s+([a-z]+)\b.*?(?:(\d*\.?\d+)\s*cents|\$(\d*\.?\d+))/i)
  if (buy) {
    const token = buy[2].toUpperCase()
    const amount_usd = Number(buy[1])
    const threshold_usd = buy[3] !== undefined ? Number(buy[3]) / 100 : Number(buy[4])
    if (!WATCHABLE_TOKENS.includes(token)) {
      return { intent: 'unsupported', reason: `I can only watch ${WATCHABLE_TOKENS.join(' and ')} prices for now.` }
    }
    if (!(amount_usd > 0) || !(threshold_usd > 0)) {
      return { intent: 'unsupported', reason: 'The amount and the price must both be more than zero.' }
    }
    return {
      amount_usd,
      condition: /\b(above|over|rises?|goes up|climbs?)\b/i.test(t) ? 'above' : 'below',
      intent: 'conditional_buy',
      threshold_usd,
      token,
    }
  }

  const guard = t.match(
    /\b(alert|notify|warn|tell|pause|stop|freeze)\b.*?\b(?:portfolio|drop|drops|fall|falls|down)\b.*?(\d*\.?\d+)\s*%/i,
  )
  if (guard) {
    const threshold_pct = Number(guard[2])
    if (!(threshold_pct > 0 && threshold_pct < 100)) {
      return { intent: 'unsupported', reason: 'The drop has to be between 0% and 100%.' }
    }
    return {
      action: /^(pause|stop|freeze)$/i.test(guard[1]) ? 'pause_activity' : 'alert_only',
      intent: 'portfolio_guard',
      threshold_pct,
      timeframe: /\b(hour|1h|60 minutes)\b/i.test(t) ? '1h' : '24h',
    }
  }

  return { intent: 'unsupported', reason: NOPE }
}
