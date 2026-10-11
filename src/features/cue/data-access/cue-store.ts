import { address, isAddress } from '@solana/kit'
import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { activeCluster, activeSolanaClient } from '@/features/cluster/data-access/active-client'
import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { allowanceLeft, voiceAllowance, voiceApprovalsOn } from '@/features/cue/data-access/voice-allowance'
import { executeAllowanceSend } from '@/features/wallet/util/execute-allowance-send'
import { fetchQuote } from '@/features/wallet/util/jupiter'
import { NATIVE_MINT_ADDRESS } from '@/features/wallet/util/spl-token'
import { BUYABLE_TOKENS } from '@/features/wallet/util/tokens'
import { ensureMicPermission } from '@/features/cue/util/mic-permission'
import { speak, speakAndWait, stopSpeaking } from '@/features/cue/util/speech'
import { spokenApproved, spokenConfirm, spokenResult } from '@/features/cue/util/spoken'
import { askBackgroundAccessOnce } from '@/features/cue/util/background-access'
import { type Intent, normalizeTranscript, WATCHABLE_TOKENS } from '@/features/cue/data-access/parse-intent'
import { getDeviceId } from '@/features/cue/data-access/device-id'
import { mainnetRpc, resolveSkr, skrLabel } from '@/features/cue/data-access/skr'
import {
  assistantConfigured,
  type Draft,
  draftOf,
  QuotaReached,
  quotaMessage,
  setDeviceIdSource,
  understand,
  understandAudio,
  understandReply,
} from '@/features/cue/data-access/understand'
import {
  createTrigger,
  formatUsd,
  type GuardAction,
  delegatedLamports,
  setDelegatedLamports,
  spendDelegation,
  type TriggerDirection,
} from '@/features/price-triggers/data-access/trigger-store'
import { $prices, type Symbol } from '@/features/prices/data-access/price-store'
import CueNative from '../../../../modules/cue-native'

export type Screen = 'compose' | 'confirm' | 'contact' | 'delegate' | 'listen' | 'nope' | 'success'
export type ComposeKind = 'buy' | 'guard' | 'send'

export type LogEntry = {
  amount: string
  at?: number // absent on entries from before timestamps were stored
  cluster?: string // the network it happened on; absent on entries from before networks were recorded (devnet)
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
  | { direction: TriggerDirection; kind: 'alert'; priceUsd: number; symbol: Symbol; targetUsd: number }
  | { kind: 'answer'; question: 'balance' | 'price' | 'rules'; symbol?: Symbol }
  | { amount: number; estimatedOut: number; from: Symbol; kind: 'swap'; to: Symbol }
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
/** Error text from a web service can be a whole HTML page: keep the words, drop the markup. */
export const plainText = (text: string) =>
  text
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()

export function pushLogEntry(entry: Omit<LogEntry, 'at' | 'cluster' | 'id'>) {
  const cue = $cue.get()
  const log = [
    { ...entry, at: Date.now(), cluster: activeCluster().id, detail: plainText(entry.detail), id: newId() },
    ...cue.log,
  ].slice(0, 100)
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
export function prepareIntent(intent: Intent, skrRecipient?: { address: string; name: string }): Plan {
  const prices = $prices.get()
  switch (intent.intent) {
    case 'unsupported':
      return nope(intent.reason)
    case 'instant_send': {
      if (intent.token !== 'SOL') return nope(`I can only send SOL for now, not ${intent.token}.`)
      if (!(intent.amount > 0)) return nope('The amount must be more than zero.')
      const to = skrRecipient ?? resolveRecipient(intent.recipient)
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
      const amountLamports = BigInt(Math.round((intent.amount_usd / prices.SOL.usd) * 1e9))
      // With voice approvals on, buy rules draw from the allowance: a new wallet approval would replace it.
      if (voiceApprovalsOn() && amountLamports > allowanceLeft()) {
        return nope(
          `That's more than your voice allowance has left (${sol(allowanceLeft())} SOL). Raise it in Settings.`,
        )
      }
      const expiresAt = intent.expires_at ? Date.parse(intent.expires_at) : NaN
      return {
        // Spends delegated WSOL, so the dollar amount is sized in SOL at today's price.
        amountLamports,
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
    case 'price_alert': {
      if (!WATCHABLE_TOKENS.includes(intent.token)) {
        return nope(`I can only watch ${WATCHABLE_TOKENS.join(', ')} prices for now.`)
      }
      if (!(intent.threshold_usd > 0)) return nope('The price must be more than zero.')
      const now = prices[intent.token as Symbol]
      if (!now) return nope(LOADING_PRICES)
      return {
        // "Tell me when SOL hits 120" names no direction: it's whichever way the price has to move to get there.
        direction: intent.condition ?? (intent.threshold_usd >= now.usd ? 'above' : 'below'),
        kind: 'alert',
        priceUsd: now.usd,
        symbol: intent.token as Symbol,
        targetUsd: intent.threshold_usd,
      }
    }
    case 'swap':
      return nope('Swaps need a live price first.') // planned in prepare(), which can fetch one
    case 'wallet_question': {
      const symbol = intent.token && WATCHABLE_TOKENS.includes(intent.token) ? (intent.token as Symbol) : undefined
      if (intent.token && !symbol) return nope(`I only know about ${WATCHABLE_TOKENS.join(', ')} for now.`)
      if (intent.question === 'price' && !symbol) return nope('Which token? I know SOL, JUP and SKR.')
      return { kind: 'answer', question: intent.question, symbol }
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

/**
 * prepareIntent, after looking up a Seeker name ("alice.skr") on mainnet, so the confirmation shows the wallet the money
 * would go to. An unregistered name or a failed lookup is said plainly, never guessed at.
 */
const SWAPPABLE: Symbol[] = ['SOL', 'JUP', 'SKR']
export const mintOf = (symbol: Symbol) => (symbol === 'SOL' ? NATIVE_MINT_ADDRESS : BUYABLE_TOKENS[symbol]!.mint)
export const decimalsOf = (symbol: Symbol) => (symbol === 'SOL' ? 9 : BUYABLE_TOKENS[symbol]!.decimals)

/** A swap right now (signed in the wallet): mainnet only, between tokens Cue knows, priced by a live Jupiter quote. */
async function prepareSwap(intent: Extract<Intent, { intent: 'swap' }>): Promise<Plan> {
  const from = intent.token as Symbol
  const to = intent.to_token as Symbol
  if (!SWAPPABLE.includes(from) || !SWAPPABLE.includes(to)) return nope('I can swap between SOL, JUP and SKR for now.')
  if (from === to) return nope(`That's ${from} to ${from}: pick a different token to get.`)
  if (!(intent.amount > 0)) return nope('The amount must be more than zero.')
  if (activeCluster().id !== 'solana:mainnet') {
    return nope('Swaps need Mainnet: Jupiter has no Devnet markets. Switch under Settings, Network.')
  }
  try {
    const quote = await fetchQuote({
      amount: BigInt(Math.round(intent.amount * 10 ** decimalsOf(from))),
      inputMint: mintOf(from),
      outputMint: mintOf(to),
      slippageBps: 50,
    })
    return {
      amount: intent.amount,
      estimatedOut: Number(quote.outAmount) / 10 ** decimalsOf(to),
      from,
      kind: 'swap',
      to,
    }
  } catch {
    return nope(`I couldn't get a price for ${from} to ${to} right now. Try again in a moment.`)
  }
}

async function prepare(intent: Intent): Promise<Plan> {
  if (intent.intent === 'swap') return prepareSwap(intent)
  const label = intent.intent === 'instant_send' ? skrLabel(intent.recipient) : null
  if (!label) return prepareIntent(intent)
  const owner = await resolveSkr(mainnetRpc, label).catch(() => undefined)
  if (owner === undefined) return nope(`I couldn't look up ${label}.skr right now. Try again in a moment.`)
  if (!owner) return nope(`${label}.skr isn't a registered Seeker name.`)
  return prepareIntent(intent, { address: owner, name: `${label}.skr` })
}

/**
 * A spoken command Cue can't carry out: back to Home, and the problem is said out loud (and shown on Home, in case the
 * sound is off). The drawer is only for commands Cue can actually do.
 */
export const $homeNotice = atom<{ canEdit: boolean; reason: string; text: string } | null>(null)

/** A question for Home to answer out loud (it has the wallet and network the answer needs); no sheet opens. */
export const $question = atom<{ question: 'balance' | 'price' | 'rules'; symbol?: Symbol; text: string } | null>(null)

function route(text: string, plan: Plan, draft: Draft | null) {
  $flow.set({ ...$flow.get(), draft, plan, signature: null, text })
  // The manual form keeps its sheet, so what was typed isn't thrown away.
  if (plan.kind === 'nope' && $flow.get().stack[0] !== 'compose') {
    $flow.set({ ...$flow.get(), stack: [] })
    $homeNotice.set({ canEdit: Boolean(draft && EDITABLE[draft.intent]), reason: plan.reason, text })
    speak(plan.reason)
    return
  }
  if (plan.kind === 'answer') {
    $flow.set({ ...$flow.get(), stack: [] })
    $question.set({ question: plan.question, symbol: plan.symbol, text })
    return
  }
  push(plan.kind === 'nope' ? 'nope' : 'confirm')
  // Said back so a misheard amount or name is caught by ear; with voice approvals the sheet says it and then listens.
  if (!canApproveByVoice(plan)) {
    const why = whyNotByVoice(plan)
    speak(why ? spokenConfirm(plan).replace('Tap continue.', why.spoken) : spokenConfirm(plan))
  }
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
    let understood: Awaited<ReturnType<typeof understand>>
    try {
      understood = await understand(
        raw,
        $cue.get().contacts.map((c) => c.name),
      )
    } catch (error) {
      if (!(error instanceof QuotaReached)) throw error
      if (stillListening(ticket)) route(text, nope(quotaMessage(error)), null)
      return
    }
    const { draft, intent } = understood
    const plan = await prepare(intent)
    // Cancelled, or a newer request started, while Claude was thinking: drop this answer.
    if (!stillListening(ticket)) return
    route(text, plan, draft)
  },
  /** The clip so far, sent at a pause while recording continues (see the listening screen). */
  hearEarly: (wav: string) => hear(wav),
  /** A recorded clip goes to the assistant, which hears and parses it. Returns false if it couldn't be reached. */
  async finishAudio(wav: string, alreadyHeard?: Heard): Promise<boolean> {
    const ticket = ++understanding
    let result: Heard | null
    try {
      result = alreadyHeard ?? (await hear(wav))
    } catch (error) {
      if (!(error instanceof QuotaReached)) throw error
      if (stillListening(ticket)) route('', nope(quotaMessage(error)), null)
      return true
    }
    if (!stillListening(ticket)) return true
    if (!result) return false
    if (!result.transcript) {
      // Nothing was said (or it wasn't speech): close quietly after a wake word, say so after a tap.
      if ($flow.get().source === 'wake') flow.cancel()
      else route('', nope("I didn't catch that."), null)
      return true
    }
    const plan = await prepare(result.intent)
    if (!stillListening(ticket)) return true
    route(result.transcript, plan, result.draft)
    return true
  },
  /** A command "Hey Cue" heard while the app was off screen: the usual understanding and confirmation, no mic needed. */
  async startFromClip(wav: string, alreadyHeard?: Heard) {
    if (!idle()) return
    $flow.set({
      ...$flow.get(),
      engine: 'none',
      live: true,
      micBlocked: false,
      notice: null,
      signature: null,
      source: 'wake',
      stack: ['listen'],
      text: '',
    })
    if (!(await flow.finishAudio(wav, alreadyHeard))) flow.useAndroidFallback()
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
    $homeNotice.set(null)
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
  async submitIntent(intent: Intent, text: string) {
    const ticket = ++understanding
    const plan = await prepare(intent)
    if (ticket !== understanding || $flow.get().stack[0] !== 'compose') return // closed while the name was looked up
    route(text, plan, draftOf(intent))
  },
}

/* ---------- execution side effects (called once the user has confirmed) ---------- */

export function recordSend(signature: string, plan: Plan = $flow.get().plan, detail = 'By you') {
  if (plan.kind !== 'send') return
  pushLogEntry({
    amount: `${plan.amount} SOL`,
    detail,
    signature,
    status: 'Confirmed',
    title: `Sent to ${plan.recipientName}`,
  })
}

export function activateBuy(
  ownerAddress: string,
  signature: string,
  totalApprovedLamports: bigint,
  plan: Plan = $flow.get().plan,
  detail = 'Permission granted',
) {
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
    detail,
    signature,
    status: 'Confirmed',
    title: `Rule set: buy ${plan.symbol} ${plan.direction} ${formatUsd(plan.targetUsd)}`,
  })
  askBackgroundAccessOnce()
}

export function activateGuard(ownerAddress: string, plan: Plan = $flow.get().plan) {
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

export function activateAlert(ownerAddress: string, plan: Plan = $flow.get().plan) {
  if (plan.kind !== 'alert') return
  createTrigger({
    direction: plan.direction,
    kind: 'alert',
    ownerAddress,
    symbol: plan.symbol,
    targetUsd: plan.targetUsd,
  })
  pushLogEntry({
    amount: '—',
    detail: `${plan.symbol} is ${formatUsd(plan.priceUsd)} now`,
    status: 'Confirmed',
    title: `Alert set: ${plan.symbol} ${plan.direction} ${formatUsd(plan.targetUsd)}`,
  })
  askBackgroundAccessOnce()
}

/* ---------- wake word ---------- */

type Heard = NonNullable<Awaited<ReturnType<typeof understandAudio>>>
const hear = (wav: string) =>
  understandAudio(
    wav,
    $cue.get().contacts.map((c) => c.name),
  )
const HEARD_LIFETIME_MS = 120_000
let heardOffScreen: { alreadyHeard: Heard | null; at: number; wav: string } | null = null

/**
 * "Hey Cue" plus a command while the app was off screen: ask the assistant now, so the notification can say what was
 * heard (or that nothing was) instead of making the user open the app to find out. Opening it then confirms as usual.
 */
export async function understandOffScreen(wav: string) {
  let result: Heard | null
  try {
    result = await hear(wav)
  } catch (error) {
    if (!(error instanceof QuotaReached)) throw error
    CueNative.notify('Daily voice limit reached', quotaMessage(error))
    speak(quotaMessage(error))
    return
  }
  if (result && !result.transcript) {
    CueNative.notify("Cue didn't hear a command", 'Say "Hey Cue" and try again')
    return
  }
  const plan = result ? await prepare(result.intent) : null
  if (result && plan?.kind === 'nope') {
    // Same as in the app: say what's wrong, no "tap to review".
    CueNative.notify("Cue can't do that", `"${result.transcript}": ${plan.reason}`)
    speak(plan.reason)
    return
  }
  // Voice approvals, phone unlocked: the whole exchange happens by voice, wherever the user is.
  // (Off screen the allowance says whose wallet to act for, so this needs one even for a guard or an alert.)
  if (result && plan && canApproveByVoice(plan) && voiceAllowance() && !CueNative.isDeviceLocked()) {
    await approveByVoice(plan, voiceAllowance()!.owner, activeSolanaClient(), 'notify')
    return
  }
  heardOffScreen = { alreadyHeard: result, at: Date.now(), wav }
  CueNative.notify(
    result ? `Cue heard: "${result.transcript}"` : 'Cue heard your command',
    'Tap to review and approve it',
  )
}

/** The command heard off screen, once, if still fresh. */
export function takeHeardOffScreen() {
  const heard = heardOffScreen
  heardOffScreen = null
  return heard && Date.now() - heard.at < HEARD_LIFETIME_MS ? heard : null
}

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

/* ---------- voice approvals ---------- */

const sol = (lamports: bigint) => Number((Number(lamports) / 1e9).toFixed(4)).toString()

/**
 * Whether this plan can be approved by saying "approve": voice approvals are on, and it fits what's left of the
 * allowance. Sends only go to a saved contact or a Seeker name, never a pasted address, so a misheard or mistyped
 * address can't be paid by voice.
 */
export function canApproveByVoice(plan: Plan): boolean {
  if (plan.kind === 'guard' || plan.kind === 'alert') return true // they move no money, so no allowance is needed
  if (!voiceApprovalsOn()) return false
  if (plan.kind === 'buy') return plan.amountLamports <= allowanceLeft() // checked in prepareIntent too
  if (plan.kind === 'send') {
    const toNamed = !plan.recipientName.includes('…')
    return toNamed && BigInt(Math.round(plan.amount * 1e9)) <= allowanceLeft()
  }
  return false
}

/**
 * A send or buy that needs a tap instead of "approve": why, and how to make it voice-only next time. `spoken` replaces
 * "Tap continue." in what Cue says; `shown` goes on the sheet.
 */
export function whyNotByVoice(plan: Plan): { shown: string; spoken: string } | null {
  if ((plan.kind !== 'send' && plan.kind !== 'buy') || canApproveByVoice(plan)) return null
  if (!voiceApprovalsOn()) {
    return {
      shown: 'To approve by voice, give Cue some SOL in Settings, under Voice approvals.',
      spoken: 'Tap continue. To approve by voice instead, give Cue some SOL in Settings, under Voice approvals.',
    }
  }
  if (plan.kind === 'send' && plan.recipientName.includes('…')) {
    return {
      shown: 'Voice approvals only pay saved contacts or Seeker names.',
      spoken: 'Voice approvals only pay saved contacts or Seeker names, so tap continue.',
    }
  }
  return {
    shown: "That's more than your voice allowance has left. You can top it up in Settings.",
    spoken: "That's more than your voice allowance has left, so tap continue. You can top it up in Settings.",
  }
}

/**
 * Listens for one reply. Approves only when the assistant heard "approve" and the words say so too (belt and braces:
 * money moves on this); anything else, or silence, declines.
 */
export async function hearApproval(): Promise<{ approved: boolean; heard: string }> {
  const wav = await CueNative.captureReply().catch(() => null)
  const reply = wav ? await understandReply(wav) : null
  const heard = reply?.transcript ?? ''
  if (__DEV__) console.log('[CueApproval] reply:', JSON.stringify(reply), wav ? `${wav.length} b64 chars` : 'no audio')
  const words = heard.toLowerCase()
  return {
    approved: reply?.answer === 'approve' && /\bapprov/.test(words) && !/\b(not|don't|decline|cancel)\b/.test(words),
    heard,
  }
}

/** What Cue says when the reply wasn't "approve", so a misheard yes isn't a silent no. */
export const declinedBecause = (heard: string) =>
  heard ? `I heard "${heard}", so nothing was done.` : "I didn't hear an answer, so nothing was done."

/** Does what the plan says, from the voice allowance: no wallet prompt. Returns the signature when money moved. */
export async function executeWithAllowance(plan: Plan, owner: string, client: SolanaClient): Promise<string | null> {
  if (plan.kind === 'send') {
    const lamports = BigInt(Math.round(plan.amount * 1e9))
    // Seeker names can change hands: look it up again right before paying, as the signed path does.
    const label = skrLabel(plan.recipientName)
    if (label && (await resolveSkr(mainnetRpc, label)) !== plan.recipient) {
      throw new Error(`${plan.recipientName} now points to a different wallet. Nothing was sent.`)
    }
    const signature = await executeAllowanceSend({
      client,
      lamports,
      ownerAddress: address(owner),
      recipient: address(plan.recipient),
    })
    spendDelegation(lamports)
    recordSend(signature, plan, 'Approved by voice')
    return signature
  }
  if (plan.kind === 'buy') activateBuy(owner, '', delegatedLamports() ?? 0n, plan, 'Approved by voice')
  if (plan.kind === 'guard') activateGuard(owner, plan)
  if (plan.kind === 'alert') activateAlert(owner, plan)
  return null
}

/**
 * The spoken exchange: say what Cue understood, listen, and act only on "approve". `report` is how the outcome is
 * told: in the app the screens show it; off screen a notification does.
 */
export async function approveByVoice(
  plan: Plan,
  owner: string,
  client: SolanaClient,
  report: 'notify' | 'screen',
  stillWanted: () => boolean = () => true,
): Promise<{ approved: boolean; signature: string | null }> {
  await speakAndWait(spokenConfirm(plan, true))
  const { approved, heard } = await hearApproval()
  if (!stillWanted()) return { approved: false, signature: null } // the user tapped Decline (or left) meanwhile
  if (!approved) {
    speak(heard.toLowerCase().includes('decline') ? 'Okay, cancelled.' : declinedBecause(heard))
    if (report === 'notify') CueNative.notify('Cancelled', spokenConfirm(plan).replace(' Tap continue.', ''))
    return { approved: false, signature: null }
  }
  const acknowledged = speakAndWait(spokenApproved(plan))
  try {
    const signature = await executeWithAllowance(plan, owner, client)
    await acknowledged
    if (report === 'notify') {
      speak(spokenResult(plan))
      CueNative.notify('Done', spokenResult(plan))
    } // in the app, the success screen says it
    return { approved: true, signature }
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error)
    speak("That didn't go through. Nothing was sent.")
    if (report === 'notify') CueNative.notify("That didn't go through", reason)
    throw error
  }
}
