import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import type { Symbol } from '@/features/prices/data-access/price-store'

const storage = createMMKV({ id: APP_STORAGE_ID })
// Kept as the original key so triggers created before Portfolio Guard existed aren't dropped.
const KEY = 'cue:conditional-buy-triggers'

export type TriggerDirection = 'above' | 'below'
export type TriggerStatus = 'active' | 'cancelled' | 'failed' | 'fired'
// 'buy' = Conditional Buy (enter a position when price hits a target). 'guard' = Portfolio Guard (exit to protect
// value when price moves against it). Same underlying mechanism — only the UI framing and default direction differ.
export type TriggerKind = 'buy' | 'guard'

export interface PriceTrigger {
  amountLamports: string // bigint as string for JSON safety
  createdAt: number
  direction: TriggerDirection
  error?: string
  firedAt?: number
  id: string
  kind: TriggerKind
  ownerAddress: string
  signature?: string
  status: TriggerStatus
  symbol: Symbol
  targetUsd: number
}

function load(): PriceTrigger[] {
  const raw = storage.getString(KEY)
  if (!raw) return []
  try {
    return JSON.parse(raw) as PriceTrigger[]
  } catch {
    return []
  }
}

// Headless task and foreground UI share this JS runtime (see price-store.ts), so this single atom, loaded once
// from MMKV at import time, stays in sync across both without extra plumbing.
export const $triggers = atom<PriceTrigger[]>(load())

function persist(triggers: PriceTrigger[]) {
  storage.set(KEY, JSON.stringify(triggers))
  $triggers.set(triggers)
}

export function createTrigger(input: {
  amountLamports: bigint
  direction: TriggerDirection
  kind: TriggerKind
  ownerAddress: string
  symbol: Symbol
  targetUsd: number
}): PriceTrigger {
  const trigger: PriceTrigger = {
    ...input,
    amountLamports: input.amountLamports.toString(),
    createdAt: Date.now(),
    id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    status: 'active',
  }
  persist([trigger, ...$triggers.get()])
  return trigger
}

export function cancelTrigger(id: string) {
  persist($triggers.get().map((t) => (t.id === id && t.status === 'active' ? { ...t, status: 'cancelled' } : t)))
}

export function markTriggerFired(id: string, signature: string) {
  persist($triggers.get().map((t) => (t.id === id ? { ...t, firedAt: Date.now(), signature, status: 'fired' } : t)))
}

export function markTriggerFailed(id: string, error: string) {
  persist($triggers.get().map((t) => (t.id === id ? { ...t, error, status: 'failed' } : t)))
}
