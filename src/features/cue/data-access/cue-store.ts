import { isAddress } from '@solana/kit'
import { atom } from 'nanostores'

import { type Intent, parseIntent } from '@/features/cue/data-access/parse-intent'

export type IntentKey = 'buy' | 'guard' | 'nope' | 'send'
export type Screen = 'confirm' | 'delegate' | 'listen' | 'nope' | 'success'

export type Rule = {
  delegated: boolean
  delegateAddress?: string
  detail: string
  id: string
  signature?: string
  title: string
  tokenAccount?: string
}
export type LogEntry = {
  amount: string
  detail: string
  id: string
  signature?: string
  status: 'Alert' | 'Confirmed'
  title: string
}

// Canned phrases stand in for the voice transcript until speech capture exists.
// TODO(cue): replace PHRASES with the real transcript, and parseIntent() with the LLM parser + deterministic validation.
export const PHRASES: Record<IntentKey, string> = {
  buy: 'Buy $20 of JUP if it drops to 85 cents',
  guard: 'Alert me if my portfolio drops 10% today',
  nope: 'Swap all my SOL to Bonk',
  send: 'Send 2 SOL to Alex',
}

export const SUGGESTIONS: { key: IntentKey; label: string }[] = [
  { key: 'send', label: 'Send 2 SOL to Alex' },
  { key: 'buy', label: 'Buy $20 of JUP below 85 cents' },
  { key: 'guard', label: 'Alert me if I drop 10%' },
  { key: 'nope', label: 'Swap all my SOL to Bonk' },
]

const KEY_OF: Record<Intent['intent'], IntentKey> = {
  conditional_buy: 'buy',
  instant_send: 'send',
  portfolio_guard: 'guard',
  unsupported: 'nope',
}

export const shortAddr = (a: string) => (a.length > 12 ? `${a.slice(0, 4)}…${a.slice(-4)}` : a)

export const $cue = atom<{
  contacts: { address: string; name: string }[]
  log: LogEntry[]
  rules: Rule[]
  wake: boolean
}>({
  // Throwaway devnet addresses (no keys kept). Replace Alex with a wallet you control to see funds arrive.
  contacts: [
    { address: 'BWGt3Yg3pKVLTJbaufw7xNzMesgsUAKTwVHRnsYg6bzv', name: 'Alex' },
    { address: '9h3wCAQfwHobHRrh5uEgyBzMPsxcGEh8V5rq2sbCABrJ', name: 'Mira' },
  ],
  log: [
    { amount: '15 USDC', detail: 'Yesterday, 6:02 PM, by you', id: 'l1', status: 'Confirmed', title: 'Sent to Mira' },
    {
      amount: '-10.4%',
      detail: 'Yesterday, 11:30 AM, alert sent',
      id: 'l2',
      status: 'Alert',
      title: 'Guard triggered',
    },
    { amount: '0.5 SOL', detail: 'Monday, 2:14 PM, by you', id: 'l3', status: 'Confirmed', title: 'Sent to Alex' },
  ],
  rules: [{ delegated: false, detail: 'Within 24 hours', id: 'r0', title: 'Pause if portfolio drops 15%' }],
  wake: true,
})

export const $flow = atom<{
  delegateAddress: string | null
  guardMode: 0 | 1
  intent: IntentKey
  parsed: Intent
  recipient: string | null // resolved wallet address for instant_send
  signature: string | null // set once a real transaction landed
  stack: Screen[]
  text: string // what the user said
  tokenAccount: string | null
}>({
  delegateAddress: null,
  guardMode: 0,
  intent: 'send',
  parsed: { intent: 'unsupported', reason: '' },
  recipient: null,
  signature: null,
  stack: [],
  text: '',
  tokenAccount: null,
})

let uid = 0
const nextId = () => `n${++uid}`
const push = (s: Screen) => $flow.set({ ...$flow.get(), stack: [...$flow.get().stack, s] })

/** A raw address passes through; otherwise match a saved contact by name. */
export function resolveRecipient(recipient: string): string | null {
  const r = recipient.trim()
  if (isAddress(r)) return r
  return $cue.get().contacts.find((c) => c.name.toLowerCase() === r.toLowerCase())?.address ?? null
}

export const flow = {
  back: () => $flow.set({ ...$flow.get(), stack: $flow.get().stack.slice(0, -1) }),
  cancel: () => $flow.set({ ...$flow.get(), stack: [] }),
  done() {
    const { delegateAddress, guardMode, intent, parsed, recipient, signature, tokenAccount } = $flow.get()
    const cue = $cue.get()
    if (intent === 'send' && parsed.intent === 'instant_send') {
      $cue.set({
        ...cue,
        log: [
          {
            amount: `${parsed.amount} ${parsed.token}`,
            detail: 'Just now, by you',
            id: nextId(),
            signature: signature ?? undefined,
            status: 'Confirmed',
            title: `Sent to ${recipient && parsed.recipient === recipient ? shortAddr(recipient) : parsed.recipient}`,
          },
          ...cue.log,
        ],
      })
    }
    if (intent === 'buy') {
      $cue.set({
        ...cue,
        rules: [
          ...cue.rules,
          {
            delegated: true,
            delegateAddress: delegateAddress ?? undefined,
            detail: 'Expires Oct 4, 11:59 PM',
            id: nextId(),
            signature: signature ?? undefined,
            title: 'Buy $20 of JUP below $0.85',
            tokenAccount: tokenAccount ?? undefined,
          },
        ],
      })
    }
    if (intent === 'guard') {
      $cue.set({
        ...cue,
        rules: [
          ...cue.rules,
          {
            delegated: false,
            detail: 'Within 24 hours',
            id: nextId(),
            title: guardMode ? 'Pause if portfolio drops 10%' : 'Alert if portfolio drops 10%',
          },
        ],
      })
    }
    flow.cancel()
  },
  /** Called when listening ends: route to confirm, or to the "can't do that" sheet with a reason. */
  parsed() {
    const f = $flow.get()
    if (f.parsed.intent === 'instant_send') {
      const to = resolveRecipient(f.parsed.recipient)
      if (!to) {
        $flow.set({
          ...f,
          intent: 'nope',
          parsed: { intent: 'unsupported', reason: `I don't have a contact named ${f.parsed.recipient}.` },
          stack: [...f.stack, 'nope'],
        })
        return
      }
      $flow.set({ ...f, recipient: to, stack: [...f.stack, 'confirm'] })
      return
    }
    push(f.intent === 'nope' ? 'nope' : 'confirm')
  },
  retry() {
    flow.cancel()
    flow.startListening('send')
  },
  review: () => push('delegate'),
  setGuardMode: (m: 0 | 1) => $flow.set({ ...$flow.get(), guardMode: m }),
  signed: (signature?: string, meta?: { delegateAddress?: string; tokenAccount?: string }) =>
    $flow.set({
      ...$flow.get(),
      delegateAddress: meta?.delegateAddress ?? $flow.get().delegateAddress,
      signature: signature ?? null,
      stack: [...$flow.get().stack, 'success'],
      tokenAccount: meta?.tokenAccount ?? $flow.get().tokenAccount,
    }),
  startListening(key: IntentKey) {
    const parsed = parseIntent(PHRASES[key])
    $flow.set({
      delegateAddress: null,
      guardMode: parsed.intent === 'portfolio_guard' && parsed.action === 'pause_activity' ? 1 : 0,
      intent: KEY_OF[parsed.intent],
      parsed,
      recipient: null,
      signature: null,
      stack: ['listen'],
      text: PHRASES[key],
      tokenAccount: null,
    })
  },
}

export const actions = {
  revoke(id: string) {
    const cue = $cue.get()
    $cue.set({ ...cue, rules: cue.rules.filter((r) => r.id !== id) })
  },
  toggleWake() {
    const cue = $cue.get()
    $cue.set({ ...cue, wake: !cue.wake })
  },
}
