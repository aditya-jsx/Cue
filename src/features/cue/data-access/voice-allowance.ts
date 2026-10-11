import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { activeCluster } from '@/features/cluster/data-access/active-client'
import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { activeBuyLamports, delegatedLamports } from '@/features/price-triggers/data-access/trigger-store'

/**
 * Voice approvals: the user sets aside an allowance once (one wallet signature: wrap SOL, approve Cue's session key
 * for that much), and afterwards says "approve" instead of signing. The cap is the on-chain approval, so nothing can
 * spend more than was set aside, whoever says "approve". Revoke returns what is left.
 */
const storage = createMMKV({ id: APP_STORAGE_ID })
const KEY = 'cue:voice-allowance'
export const DEFAULT_ALLOWANCE_SOL = 0.5

/**
 * One allowance per network (an allowance granted on devnet doesn't exist on mainnet): whose wallet it's on, since
 * background commands act for it. A single record from before networks were recorded is devnet's (or the network it
 * names).
 */
type Allowance = { owner: string }
export const $voiceAllowances = atom<Record<string, Allowance>>(load())

function load(): Record<string, Allowance> {
  try {
    const raw = storage.getString(KEY)
    if (!raw) return {}
    const parsed = JSON.parse(raw) as Record<string, Allowance> | { cluster?: string; owner: string }
    if (typeof parsed.owner === 'string')
      return { [String(parsed.cluster ?? 'solana:devnet')]: { owner: parsed.owner } }
    return parsed as Record<string, Allowance>
  } catch {
    return {}
  }
}

/** The allowance on `clusterId` (default: the network in use), or null when voice approvals are off there. */
export function voiceAllowance(clusterId: string = activeCluster().id): Allowance | null {
  return $voiceAllowances.get()[clusterId] ?? null
}

export function setVoiceAllowance(value: Allowance | null, clusterId: string = activeCluster().id) {
  const next = { ...$voiceAllowances.get() }
  if (value) next[clusterId] = value
  else delete next[clusterId]
  storage.set(KEY, JSON.stringify(next))
  $voiceAllowances.set(next)
}

/** What voice approvals can still spend: the approved allowance, minus what waiting buy rules have set aside. */
export function allowanceLeft(): bigint {
  const approved = delegatedLamports()
  if (!voiceApprovalsOn() || approved === null) return 0n
  const left = approved - activeBuyLamports()
  return left > 0n ? left : 0n
}

/** On for the network the app is using now. */
export function voiceApprovalsOn(): boolean {
  return voiceAllowance() !== null && delegatedLamports() !== null
}
