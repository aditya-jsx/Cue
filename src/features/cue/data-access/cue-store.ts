import { isAddress } from '@solana/kit'
import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { ensureMicPermission } from '@/features/cue/util/mic-permission'
import { speak, stopSpeaking } from '@/features/cue/util/speech'
import { spokenConfirm, spokenResult } from '@/features/cue/util/spoken'
import { askBackgroundAccessOnce } from '@/features/cue/util/background-access'
import { type Intent, normalizeTranscript, WATCHABLE_TOKENS } from '@/features/cue/data-access/parse-intent'
import { getDeviceId } from '@/features/cue/data-access/device-id'
import {
  assistantConfigured,
  type Draft,
  setDeviceIdSource,
  understand,
  understandAudio,
} from '@/features/cue/data-access/understand'
import {
  createTrigger,
  formatUsd,
  type GuardAction,
  setDelegatedLamports,
  type TriggerDirection,
} from '@/features/price-triggers/data-access/trigger-store'
import { $prices, type Symbol } from '@/features/prices/data-access/price-store'
import CueNative from '../../../../modules/cue-native'

export type Screen = 'compose' | 'confirm' | 'contact' | 'delegate' | 'listen' | 'nope' | 'success'
export type ComposeKind = 'buy' | 'guard' | 'send'

export type LogEntry = {
  amount: string
  at?: number // absent on entries from before timestamps were stored
  detail: string
  id: string
  signature?: string
  status: 'Alert' | 'Confirmed'
  title: string
}

/** An intent that passed deterministic validation, with everything execution needs already resolved. */
export type Plan =
  | { amount: number; kind: 'send'; recipient: string; recipientName: string }
  | {
      amountLamports: bigint
      amountUsd: number
      direction: TriggerDirection
      expiresAt: number
      kind: 'buy'
      priceUsd: number
      solUsd: number
      symbol: Symbol
      targetUsd: number
    }
  | { action: GuardAction; baselineUsd: number; kind: 'guard'; thresholdPct: number; timeframe: '1h' | '24h' }
  | { kind: 'nope'; reason: string }

// Tapping one plays it through the same listening → parse → validate path as speaking it.
export const SUGGESTIONS = [
  'Send 0.1 SOL to Alex',
  'Buy $5 of JUP if it drops to 30 cents',
  'Alert me if my portfolio drops 10% today',
  'Swap all my SOL to Bonk',
]

const HOUR = 3_600_000
const DAY = 24 * HOUR
const MAX_RULE_USD = 50
const LOADING_PRICES = "I'm still loading live prices. Try again in a few seconds."

setDeviceIdSource(getDeviceId)

const storage = createMMKV({ id: APP_STORAGE_ID })
const LOG_KEY = 'cue:activity-log'
const WAKE_KEY = 'cue:wake-enabled'
const CONTACTS_KEY = 'cue:contacts'

function loadLog(): LogEntry[] {
  try {
    return JSON.parse(storage.getString(LOG_KEY) ?? '[]') as LogEntry[]
  } catch {
    return []
  }
}

export type Contact = { address: string; name: string }

function loadContacts(): Contact[] {
  try {
    return JSON.parse(storage.getString(CONTACTS_KEY) ?? '[]') as Contact[]
  } catch {
    return []
  }
}

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a)
const newId = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`

export const $cue = atom<{
  contacts: Contact[]
  log: LogEntry[]
  wake: boolean
}>({
  contacts: loadContacts(),
  log: loadLog(),
  wake: storage.getBoolean(WAKE_KEY) ?? true,
})

/** Prepends a real Activity entry — used by every execution path (voice, manual, and the background engine). */
export function pushLogEntry(entry: Omit<LogEntry, 'at' | 'id'>) {
  const cue = $cue.get()
  const log = [{ ...entry, at: Date.now(), id: newId() }, ...cue.log].slice(0, 100)
  storage.set(LOG_KEY, JSON.stringify(log))
  $cue.set({ ...cue, log })
}

const consonants = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z]/g, '')
    .replace(/[aeiou]/g, '')

/** A raw address passes through; otherwise match a saved contact by name. Falls back to a consonant-only match
 * ("Alex" heard as "LX") since on-device STT sometimes drops the vowels of a short trailing name. */
export function resolveRecipient(recipient: string): { address: string; name: string } | null {
  const r = recipient.trim()
  if (isAddress(r)) return { address: r, name: shortAddr(r) }
  const { contacts } = $cue.get()
  const skeleton = consonants(r)
  return (
    contacts.find((c) => c.name.toLowerCase() === r.toLowerCase()) ??
    (skeleton ? contacts.find((c) => consonants(c.name) === skeleton) : undefined) ??
    null
  )
}

const nope = (reason: string): Plan => ({ kind: 'nope', reason })

/** Words the speech recognizer should favor: Cue's verbs, units, tokens and the user's contacts. */
export function speechHints(): string[] {
  const words = [
    'Cue',
    'send',
    'buy',
    'dollars',
    'cents',
    'percent',
    'portfolio',
    'pause',
    'alert',
    'Jupiter',
    'Solana',
  ]
  return [...words, ...WATCHABLE_TOKENS, ...$cue.get().contacts.map((c) => c.name)]
}

/** Deterministic validation between the parser and anything that executes — the same gate for voice and manual. */
export function prepareIntent(intent: Intent): Plan {
  const prices = $prices.get()
  switch (intent.intent) {
    case 'unsupported':
      return nope(intent.reason)
    case 'instant_send': {
      if (intent.token !== 'SOL') return nope(`I can only send SOL for now, not ${intent.token}.`)
      if (!(intent.amount > 0)) return nope('The amount must be more than zero.')
      const to = resolveRecipient(intent.recipient)
      if (!to) return nope(`I don't have a contact named ${intent.recipient}.`)
      return { amount: intent.amount, kind: 'send', recipient: to.address, recipientName: to.name }
    }
    case 'conditional_buy': {
      if (!WATCHABLE_TOKENS.includes(intent.token)) {
        return nope(`I can only watch ${WATCHABLE_TOKENS.join(' and ')} prices for now.`)
      }
      if (!(intent.amount_usd > 0) || !(intent.threshold_usd > 0)) {
        return nope('The amount and the price must both be more than zero.')
      }
      const token = prices[intent.token as Symbol]
      if (!prices.SOL || !token) return nope(LOADING_PRICES)
      if (intent.amount_usd > MAX_RULE_USD) return nope(`Cue can set aside up to $${MAX_RULE_USD} per rule for now.`)
      const expiresAt = intent.expires_at ? Date.parse(intent.expires_at) : NaN
      return {
        // Spends delegated WSOL, so the dollar amount is sized in SOL at today's price.
        amountLamports: BigInt(Math.round((intent.amount_usd / prices.SOL.usd) * 1e9)),
        amountUsd: intent.amount_usd,
        direction: intent.condition,
        expiresAt: Number.isFinite(expiresAt) ? expiresAt : Date.now() + DAY,
        kind: 'buy',
        priceUsd: token.usd,
        solUsd: prices.SOL.usd,
        symbol: intent.token as Symbol,
        targetUsd: intent.threshold_usd,
      }
    }
    case 'portfolio_guard':
      if (!(intent.threshold_pct > 0 && intent.threshold_pct < 100))
        return nope('The drop has to be between 0% and 100%.')
      if (!prices.SOL) return nope(LOADING_PRICES)
      return {
        action: intent.action,
        baselineUsd: prices.SOL.usd,
        kind: 'guard',
        thresholdPct: intent.threshold_pct,
        timeframe: intent.timeframe,
      }
  }
}

export const $flow = atom<{
  compose: ComposeKind
  draft: Draft | null // what was understood (even partly), so "Edit details" can pre-fill the form
  engine: 'android' | 'gemini' | 'none' // who is hearing the user: the Gemini assistant (default), Android's recognizer (fallback), or nobody (no microphone)
  micBlocked: boolean // the microphone is off for Cue, so the listening screen offers to open Settings
  notice: string | null // shown on the listening screen, e.g. why voice switched to the fallback
  live: boolean // true when `text` is a real transcript streaming in, not a tapped suggestion
  source: 'mic' | 'wake' // who opened listening: a wake-word hit may be a false alarm, so it fails quietly
  plan: Plan
  signature: string | null // set once a real transaction landed
  stack: Screen[]
  text: string // what the user said, or a sentence describing what they entered
}>({
  compose: 'send',
  draft: null,
  engine: 'gemini',
  live: false,
  micBlocked: false,
  notice: null,
  plan: nope(''),
  source: 'mic',
  signature: null,
  stack: [],
  text: '',
})

const push = (s: Screen) => $flow.set({ ...$flow.get(), stack: [...$flow.get().stack, s] })
const idle = () => $flow.get().stack.length === 0
const EDITABLE: Partial<Record<Intent['intent'], ComposeKind>> = {
  conditional_buy: 'buy',
  instant_send: 'send',
  portfolio_guard: 'guard',
}
let understanding = 0
const stillListening = (ticket: number) => {
  // Cancelled, or a newer request started, while the assistant was thinking: the answer is dropped.
  const { stack } = $flow.get()
  return ticket === understanding && stack.length === 1 && stack[0] === 'listen'
}

function route(text: string, plan: Plan, draft: Draft | null) {
  $flow.set({ ...$flow.get(), draft, plan, signature: null, text })
  push(plan.kind === 'nope' ? 'nope' : 'confirm')
  speak(spokenConfirm(plan)) // say it back, so a misheard amount or name is caught by ear
}

export const flow = {
  back: () => $flow.set({ ...$flow.get(), stack: $flow.get().stack.slice(0, -1) }),
  cancel() {
    stopSpeaking()
    $flow.set({ ...$flow.get(), stack: [] })
  },
  // Not cancel(): the "Sent…" line may still be playing, and Done shouldn't cut it off.
  done: () => $flow.set({ ...$flow.get(), stack: [] }),
  /** Every spoken or tapped sentence ends here: understand, validate, route. */
  async finishListening(raw: string) {
    const text = normalizeTranscript(raw)
    if (!text) return route(text, nope("I didn't catch that."), null)
    const ticket = ++understanding
    const { draft, intent } = await understand(
      raw,
      $cue.get().contacts.map((c) => c.name),
    )
    // Cancelled, or a newer request started, while Claude was thinking: drop this answer.
    if (!stillListening(ticket)) return
    route(text, prepareIntent(intent), draft)
  },
  /** A recorded clip goes to the assistant, which hears and parses it. Returns false if it couldn't be reached. */
  async finishAudio(wav: string): Promise<boolean> {
    const ticket = ++understanding
    const result = await understandAudio(
      wav,
      $cue.get().contacts.map((c) => c.name),
    )
    if (!stillListening(ticket)) return true
    if (!result) return false
    if (!result.transcript) {
      // Nothing was said (or it wasn't speech): close quietly after a wake word, say so after a tap.
      if ($flow.get().source === 'wake') flow.cancel()
      else route('', nope("I didn't catch that."), null)
      return true
    }
    route(result.transcript, prepareIntent(result.intent), result.draft)
    return true
  },
  /** The assistant is unreachable: switch to Android's recognizer so voice still works, and say why. */
  useAndroidFallback() {
    $flow.set({ ...$flow.get(), engine: 'android', notice: "Cue's assistant is unreachable. Say it again.", text: '' })
  },
  /** Speech got a detail wrong ("$55" for "five dollars"): reopen what was understood as a pre-filled form. */
  edit() {
    const { draft } = $flow.get()
    const kind = draft && EDITABLE[draft.intent]
    if (kind) $flow.set({ ...$flow.get(), compose: kind, live: false, stack: ['compose'] })
  },
  openContact() {
    if (idle()) $flow.set({ ...$flow.get(), stack: ['contact'] })
  },
  openCompose(kind: ComposeKind) {
    if (!idle()) return
    stopSpeaking()
    $flow.set({ ...$flow.get(), compose: kind, draft: null, live: false, stack: ['compose'] })
  },
  /** From a manual entry, back to the form; from speech, listen again. */
  retry() {
    if ($flow.get().stack[0] === 'compose') return flow.back()
    flow.cancel()
    flow.startLiveListening('mic')
  },
  review: () => push('delegate'),
  setGuardAction(action: GuardAction) {
    const { plan } = $flow.get()
    if (plan.kind === 'guard') $flow.set({ ...$flow.get(), plan: { ...plan, action } })
  },
  signed(signature?: string) {
    const { plan, stack } = $flow.get()
    $flow.set({ ...$flow.get(), signature: signature ?? null })
    push('success')
    if (stack[0] !== 'compose') speak(spokenResult(plan)) // only answer out loud to a voice command
  },
  /** Suggestion chip: plays the sentence through the listening screen, then the same path as speech. */
  startListening(text: string) {
    if (!idle()) return
    stopSpeaking()
    $flow.set({ ...$flow.get(), live: false, signature: null, stack: ['listen'], text })
  },
  /** Voice can't work without the microphone: say so and offer Settings, instead of a silent "didn't catch that". */
  blockMic() {
    $flow.set({
      ...$flow.get(),
      engine: 'none',
      live: true,
      micBlocked: true,
      notice: 'Cue needs the microphone to hear you.',
      text: '',
    })
  },
  /** Mic button or wake word. No-ops if a flow screen is already open, so a stray wake word can't interrupt it. */
  async startLiveListening(source: 'mic' | 'wake' = 'mic') {
    if (!idle()) return
    stopSpeaking() // the microphone is about to open: Cue must not record its own voice
    if (!(await ensureMicPermission())) {
      if (idle()) {
        $flow.set({ ...$flow.get(), signature: null, source, stack: ['listen'] })
        flow.blockMic()
      }
      return
    }
    if (!idle()) return // a second tap landed while the permission prompt was open
    $flow.set({
      ...$flow.get(),
      engine: assistantConfigured ? 'gemini' : 'android',
      live: true,
      micBlocked: false,
      notice: null,
      signature: null,
      source,
      stack: ['listen'],
      text: '',
    })
  },
  setTranscript: (text: string) => $flow.set({ ...$flow.get(), text }),
  /** Manual entry: the form builds the same Intent the parser would, and goes through the same gate. */
  submitIntent(intent: Intent, text: string) {
    route(text, prepareIntent(intent), intent.intent === 'unsupported' ? null : intent)
  },
}

/* ---------- execution side effects (called once the user has confirmed) ---------- */

export function recordSend(signature: string) {
  const { plan } = $flow.get()
  if (plan.kind !== 'send') return
  pushLogEntry({
    amount: `${plan.amount} SOL`,
    detail: 'By you',
    signature,
    status: 'Confirmed',
    title: `Sent to ${plan.recipientName}`,
  })
}

export function activateBuy(ownerAddress: string, signature: string, totalApprovedLamports: bigint) {
  const { plan } = $flow.get()
  if (plan.kind !== 'buy') return
  createTrigger({
    amountLamports: plan.amountLamports.toString(),
    amountUsd: plan.amountUsd,
    direction: plan.direction,
    expiresAt: plan.expiresAt,
    kind: 'buy',
    ownerAddress,
    symbol: plan.symbol,
    targetUsd: plan.targetUsd,
  })
  setDelegatedLamports(totalApprovedLamports)
  pushLogEntry({
    amount: `$${plan.amountUsd}`,
    detail: 'Permission granted',
    signature,
    status: 'Confirmed',
    title: `Rule set: buy ${plan.symbol} ${plan.direction} ${formatUsd(plan.targetUsd)}`,
  })
  askBackgroundAccessOnce()
}

export function activateGuard(ownerAddress: string) {
  const { plan } = $flow.get()
  if (plan.kind !== 'guard') return
  createTrigger({
    action: plan.action,
    baselineAt: Date.now(),
    baselineUsd: plan.baselineUsd,
    kind: 'guard',
    ownerAddress,
    thresholdPct: plan.thresholdPct,
    windowMs: plan.timeframe === '1h' ? HOUR : DAY,
  })
  pushLogEntry({
    amount: `-${plan.thresholdPct}%`,
    detail: `Watching from SOL ${formatUsd(plan.baselineUsd)}`,
    status: 'Confirmed',
    title: plan.action === 'pause_activity' ? 'Guard on: pause' : 'Guard on: alert',
  })
  askBackgroundAccessOnce()
}

/* ---------- wake word ---------- */

/** Hands the mic back to the wake-word service, unless the user turned it off. */
export function resumeWakeWord() {
  if ($cue.get().wake) CueNative.startWakeWordService()
}

/** Validates and saves a contact. Returns an error message, or null when saved. */
export function addContact(rawName: string, rawAddress: string): string | null {
  const name = rawName.trim().replace(/\s+/g, ' ')
  const address = rawAddress.trim()
  if (!name) return 'Give this contact a name.'
  if (!isAddress(address)) return "That doesn't look like a Solana address."
  const { contacts } = $cue.get()
  if (contacts.some((c) => c.name.toLowerCase() === name.toLowerCase()))
    return `You already have a contact named ${name}.`
  const next = [...contacts, { address, name }]
  storage.set(CONTACTS_KEY, JSON.stringify(next))
  $cue.set({ ...$cue.get(), contacts: next })
  return null
}

export function removeContact(address: string) {
  const next = $cue.get().contacts.filter((c) => c.address !== address)
  storage.set(CONTACTS_KEY, JSON.stringify(next))
  $cue.set({ ...$cue.get(), contacts: next })
}

export const actions = {
  toggleWake() {
    const cue = $cue.get()
    const wake = !cue.wake
    storage.set(WAKE_KEY, wake)
    $cue.set({ ...cue, wake })
    if (wake) CueNative.startWakeWordService()
    else CueNative.stopWakeWordService()
  },
}
