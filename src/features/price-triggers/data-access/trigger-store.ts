import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { activeCluster } from '@/features/cluster/data-access/active-client'
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
  cluster?: string // the network it was made on; absent on rules from before networks were recorded (devnet)
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

/** Price Alert: tells the user once when `symbol` crosses `targetUsd`. Nothing is bought. */
export interface AlertTrigger extends TriggerBase {
  direction: TriggerDirection
  kind: 'alert'
  symbol: Symbol
  targetUsd: number
}

export type PriceTrigger = AlertTrigger | BuyTrigger | GuardTrigger
export type NewTrigger =
  Omit<AlertTrigger, keyof TriggerBase> | Omit<BuyTrigger, keyof TriggerBase> | Omit<GuardTrigger, keyof TriggerBase>

function load(): PriceTrigger[] {
  const raw = storage.getString(KEY)
  if (!raw) return []
  try {
    // Guards from before alert/pause semantics were stop-loss transfers with no thresholdPct; they can't be evaluated.
    return (JSON.parse(raw) as PriceTrigger[]).filter((t) => t.kind !== 'guard' || 'thresholdPct' in t)
  } catch {
    return []
  }
}

// Headless task and foreground UI share this JS runtime (see price-store.ts), so this single atom, loaded once
// from MMKV at import time, stays in sync across both without extra plumbing.
export const $triggers = atom<PriceTrigger[]>(load())
/** Rules belong to one network: a devnet rule must never be checked (or spend) on mainnet. */
export const onCluster = (t: { cluster?: string }, clusterId: string) => (t.cluster ?? 'solana:devnet') === clusterId

// WSOL the session key is approved to spend, per network (lamports as strings). An approval on devnet says nothing
// about mainnet. A bare number from before networks were recorded is devnet's.
function loadDelegations(): Record<string, string> {
  const raw = storage.getString(DELEGATION_KEY)
  if (!raw) return {}
  if (/^\d+$/.test(raw)) return { 'solana:devnet': raw }
  try {
    return JSON.parse(raw) as Record<string, string>
  } catch {
    return {}
  }
}
export const $delegations = atom<Record<string, string>>(loadDelegations())

/** What the session key may still spend on `clusterId` (default: the network in use), or null when nothing is. */
export function delegatedLamports(clusterId: string = activeCluster().id): bigint | null {
  const value = $delegations.get()[clusterId]
  return value === undefined ? null : BigInt(value)
}

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
    cluster: activeCluster().id,
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
export function stopBuyTriggers(reason: string, clusterId: string = activeCluster().id): number {
  let stopped = 0
  persist(
    $triggers.get().map((t) => {
      if (t.kind !== 'buy' || t.status !== 'active' || !onCluster(t, clusterId)) return t
      stopped++
      return { ...t, error: reason, status: 'cancelled' }
    }),
  )
  return stopped
}

export function activeBuyLamports(clusterId: string = activeCluster().id): bigint {
  return $triggers
    .get()
    .filter((t): t is BuyTrigger => t.kind === 'buy' && t.status === 'active' && onCluster(t, clusterId))
    .reduce((sum, t) => sum + BigInt(t.amountLamports), 0n)
}

export function setDelegatedLamports(lamports: bigint | null, clusterId: string = activeCluster().id) {
  const next = { ...$delegations.get() }
  if (lamports === null) delete next[clusterId]
  else next[clusterId] = lamports.toString()
  storage.set(DELEGATION_KEY, JSON.stringify(next))
  $delegations.set(next)
}

/** A buy spent `lamports` of the on-chain allowance, so less is left to spend. */
export function spendDelegation(lamports: bigint, clusterId: string = activeCluster().id) {
  const left = delegatedLamports(clusterId)
  if (left !== null) setDelegatedLamports(left > lamports ? left - lamports : 0n, clusterId)
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
  if (t.kind === 'alert') {
    return {
      detail: 'Tells you once, buys nothing',
      title: `Alert when ${t.symbol} ${t.direction === 'above' ? 'rises above' : 'falls below'} ${formatUsd(t.targetUsd)}`,
    }
  }
  const window = t.windowMs <= 3_600_000 ? '1 hour' : '24 hours'
  return {
    detail: `Within ${window} · from ${formatUsd(t.baselineUsd)}`,
    title: `${t.action === 'pause_activity' ? 'Pause' : 'Alert'} if portfolio drops ${t.thresholdPct}%`,
  }
}
