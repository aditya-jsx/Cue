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

const NOPE = "I can't do that yet."

export function parseIntent(text: string): Intent {
  const t = text.trim()

  const send = t.match(/^send\s+(\d+(?:\.\d+)?)\s*([a-z]+)?\s+to\s+(.+)$/i)
  if (send) {
    const amount = Number(send[1])
    const token = (send[2] ?? 'SOL').toUpperCase()
    if (!(amount > 0)) return { intent: 'unsupported', reason: 'The amount must be more than zero.' }
    if (token !== 'SOL') return { intent: 'unsupported', reason: `I can only send SOL for now, not ${token}.` }
    return { amount, intent: 'instant_send', recipient: send[3].trim(), token }
  }

  const buy = t.match(
    /^buy\s+\$?(\d+(?:\.\d+)?)\s+(?:of|worth of)\s+([a-z]+)\b.*?(?:(\d+(?:\.\d+)?)\s*cents|\$(\d*\.?\d+))/i,
  )
  if (buy) {
    const threshold_usd = buy[3] !== undefined ? Number(buy[3]) / 100 : Number(buy[4])
    return {
      amount_usd: Number(buy[1]),
      condition: /\b(above|over|rises?|goes up)\b/i.test(t) ? 'above' : 'below',
      intent: 'conditional_buy',
      threshold_usd,
      token: buy[2].toUpperCase(),
    }
  }

  const guard = t.match(
    /\b(alert|notify|pause|stop)\b.*?\b(?:portfolio|drop|drops|fall|falls)\b.*?(\d+(?:\.\d+)?)\s*%/i,
  )
  if (guard) {
    return {
      action: /^(pause|stop)$/i.test(guard[1]) ? 'pause_activity' : 'alert_only',
      intent: 'portfolio_guard',
      threshold_pct: Number(guard[2]),
      timeframe: /\b(hour|1h)\b/i.test(t) ? '1h' : '24h',
    }
  }

  return { intent: 'unsupported', reason: NOPE }
}
