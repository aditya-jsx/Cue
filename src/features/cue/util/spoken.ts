// What Cue says out loud. Pure text, so the wording is tested without a phone. Spoken sentences are written for the
// ear: "30 cents" and "Jupiter", never "$0.30" and "JUP".

export type SpokenPlan =
  | { amount: number; kind: 'send'; recipientName: string }
  | { amountUsd: number; direction: 'above' | 'below'; kind: 'buy'; symbol: string; targetUsd: number }
  | { action: 'alert_only' | 'pause_activity'; kind: 'guard'; thresholdPct: number; timeframe: '1h' | '24h' }
  | { direction: 'above' | 'below'; kind: 'alert'; symbol: string; targetUsd: number }
  | { kind: 'answer' }
  | { kind: 'nope'; reason: string }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`

/** A price the way a person says it: "30 cents", "1.25 dollars". */
export function spokenPrice(usd: number): string {
  if (usd >= 1) return plural(Number(usd.toFixed(2)), 'dollar', 'dollars')
  const cents = Number((usd * 100).toFixed(2)) // same digits as the $0.0166 shown on screen
  return cents >= 1 ? plural(cents, 'cent', 'cents') : `${usd} dollars`
}

export const spokenToken = (symbol: string) => (symbol === 'JUP' ? 'Jupiter' : symbol === 'SKR' ? 'Seeker' : symbol)
const moves = (direction: 'above' | 'below') => (direction === 'below' ? 'falls to' : 'rises to')
const frame = (timeframe: '1h' | '24h') => (timeframe === '1h' ? 'an hour' : '24 hours')
const reaction = (action: 'alert_only' | 'pause_activity') =>
  action === 'pause_activity' ? 'pause your buy rules' : 'alert you'
// A recipient with no saved name is shown as a shortened address ("BWGt…6bzv"), which is no use read aloud.
const who = (name: string) => (name.includes('…') ? `the address ending ${name.slice(-4).split('').join(' ')}` : name)

/** After Cue understands a voice command: say it back, so a misheard amount or name is caught by ear. */
export function spokenConfirm(plan: SpokenPlan): string {
  switch (plan.kind) {
    case 'send':
      return `Send ${plan.amount} SOL to ${who(plan.recipientName)}. Tap confirm and sign.`
    case 'buy':
      return `Buy ${plural(plan.amountUsd, 'dollar', 'dollars')} of ${spokenToken(plan.symbol)} when it ${moves(plan.direction)} ${spokenPrice(plan.targetUsd)}. Tap review permission to continue.`
    case 'guard':
      return `Watch for a ${plan.thresholdPct} percent drop in ${frame(plan.timeframe)}, and ${reaction(plan.action)}. Tap turn on guard.`
    case 'alert':
      return `Tell you when ${spokenToken(plan.symbol)} ${plan.direction === 'above' ? 'rises above' : 'falls below'} ${spokenPrice(plan.targetUsd)}. Tap turn on alert.`
    case 'answer':
      return '' // the answer screen says it once it has looked it up
    case 'nope':
      return plan.reason
  }
}

/** After the action went through. */
export function spokenResult(plan: SpokenPlan): string {
  switch (plan.kind) {
    case 'send':
      return `Sent ${plan.amount} SOL to ${who(plan.recipientName)}.`
    case 'buy':
      return `Rule is live. I'll buy ${plural(plan.amountUsd, 'dollar', 'dollars')} of ${spokenToken(plan.symbol)} when it ${moves(plan.direction)} ${spokenPrice(plan.targetUsd)}.`
    case 'guard':
      return `Guard is on. I'll ${reaction(plan.action)} if your portfolio drops ${plan.thresholdPct} percent in ${frame(plan.timeframe)}.`
    case 'alert':
      return `Alert is on. I'll tell you when ${spokenToken(plan.symbol)} ${plan.direction === 'above' ? 'rises above' : 'falls below'} ${spokenPrice(plan.targetUsd)}.`
    case 'answer':
    case 'nope':
      return ''
  }
}
