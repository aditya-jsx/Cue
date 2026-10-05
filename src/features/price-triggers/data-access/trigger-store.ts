import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import type { Symbol } from '@/features/prices/data-access/price-store'

const storage = createMMKV({ id: APP_STORAGE_ID })
// Kept as the original key so buy rules created before Portfolio Guard existed aren't dropped.
const KEY = 'cue:conditional-buy-triggers'
const DELEGATION_KEY = 'cue:delegated-lamports'

export type TriggerDirection = 'above' | 'below'
export type TriggerStatus = 'active' | 'cancelled' | 'expired' | 'failed' | 'fired'
export type GuardAction = 'alert_only' | 'pause_activity'

interface TriggerBase {
  createdAt: number
  error?: string
  firedAt?: number
  id: string
  ownerAddress: string
  signature?: string
  status: TriggerStatus
}

/** Conditional Buy: when `symbol` crosses `targetUsd`, the session key spends `amountLamports` of delegated WSOL. */
export interface BuyTrigger extends TriggerBase {
  amountLamports: string // bigint as string for JSON safety
  amountUsd?: number // absent on rules made before USD sizing
  direction: TriggerDirection
  expiresAt?: number
  kind: 'buy'
  symbol: Symbol
  targetUsd: number
}

/** Portfolio Guard: fires when SOL falls `thresholdPct` below its price at the start of the current window. */
export interface GuardTrigger extends TriggerBase {
  action: GuardAction
  baselineAt: number
  baselineUsd: number
  kind: 'guard'
  thresholdPct: number
  windowMs: number
}

export type PriceTrigger = BuyTrigger | GuardTrigger
export type NewTrigger = Omit<BuyTrigger, keyof TriggerBase> | Omit<GuardTrigger, keyof TriggerBase>

function load(): PriceTrigger[] {
  const raw = storage.getString(KEY)
  if (!raw) return []
  try {
    // Guards from before alert/pause semantics were stop-loss transfers with no thresholdPct; they can't be evaluated.
    return (JSON.parse(raw) as PriceTrigger[]).filter((t) => t.kind === 'buy' || 'thresholdPct' in t)
  } catch {
    return []
  }
}

// Headless task and foreground UI share this JS runtime (see price-store.ts), so this single atom, loaded once
// from MMKV at import time, stays in sync across both without extra plumbing.
export const $triggers = atom<PriceTrigger[]>(load())
// Total WSOL the session key is currently approved to spend, or null when nothing is delegated.
export const $delegatedLamports = atom<bigint | null>(
  storage.getString(DELEGATION_KEY) ? BigInt(storage.getString(DELEGATION_KEY)!) : null,
)

function persist(triggers: PriceTrigger[]) {
  storage.set(KEY, JSON.stringify(triggers))
  $triggers.set(triggers)
}

function update(id: string, patch: Partial<TriggerBase>) {
  persist($triggers.get().map((t) => (t.id === id ? { ...t, ...patch } : t)))
}

export function createTrigger(input: NewTrigger & { ownerAddress: string }): PriceTrigger {
  const trigger = {
    ...input,
    createdAt: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'active',
  } as PriceTrigger
  persist([trigger, ...$triggers.get()])
  return trigger
}

export function cancelTrigger(id: string) {
  persist($triggers.get().map((t) => (t.id === id && t.status === 'active' ? { ...t, status: 'cancelled' } : t)))
}

export const markTriggerFired = (id: string, signature?: string) =>
  update(id, { firedAt: Date.now(), signature, status: 'fired' })
export const markTriggerFailed = (id: string, error: string) => update(id, { error, status: 'failed' })
export const markTriggerExpired = (id: string) => update(id, { status: 'expired' })

export function rebaselineGuard(id: string, baselineUsd: number) {
  persist(
    $triggers.get().map((t) => (t.id === id && t.kind === 'guard' ? { ...t, baselineAt: Date.now(), baselineUsd } : t)),
  )
}

/** Cancels every active buy rule (a guard's pause action, or a revoked delegation). Returns how many stopped. */
export function stopBuyTriggers(reason: string): number {
  let stopped = 0
  persist(
    $triggers.get().map((t) => {
      if (t.kind !== 'buy' || t.status !== 'active') return t
      stopped++
      return { ...t, error: reason, status: 'cancelled' }
    }),
  )
  return stopped
}

export function activeBuyLamports(): bigint {
  return $triggers
    .get()
    .filter((t): t is BuyTrigger => t.kind === 'buy' && t.status === 'active')
    .reduce((sum, t) => sum + BigInt(t.amountLamports), 0n)
}

export function setDelegatedLamports(lamports: bigint | null) {
  if (lamports === null) storage.remove(DELEGATION_KEY)
  else storage.set(DELEGATION_KEY, lamports.toString())
  $delegatedLamports.set(lamports)
}

/** A buy spent `lamports` of the on-chain allowance, so less is left to spend. */
export function spendDelegation(lamports: bigint) {
  const left = $delegatedLamports.get()
  if (left !== null) setDelegatedLamports(left > lamports ? left - lamports : 0n)
}

export const formatUsd = (n: number) => `$${n >= 1 ? n.toFixed(2) : n.toFixed(4).replace(/0{1,2}$/, '')}`

export function describeTrigger(t: PriceTrigger): { detail: string; title: string } {
  if (t.kind === 'buy') {
    const spend = t.amountUsd ? `$${t.amountUsd}` : `${(Number(t.amountLamports) / 1e9).toFixed(4)} WSOL`
    return {
      detail: t.expiresAt
        ? `Expires ${new Date(t.expiresAt).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`
        : 'No expiry',
      title: `Buy ${spend} of ${t.symbol} ${t.direction} ${formatUsd(t.targetUsd)}`,
    }
  }
  const window = t.windowMs <= 3_600_000 ? '1 hour' : '24 hours'
  return {
    detail: `Within ${window} · from ${formatUsd(t.baselineUsd)}`,
    title: `${t.action === 'pause_activity' ? 'Pause' : 'Alert'} if portfolio drops ${t.thresholdPct}%`,
  }
}
