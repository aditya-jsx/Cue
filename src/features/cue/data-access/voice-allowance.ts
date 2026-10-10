import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { $delegatedLamports, activeBuyLamports } from '@/features/price-triggers/data-access/trigger-store'

/**
 * Voice approvals: the user sets aside an allowance once (one wallet signature: wrap SOL, approve Cue's session key
 * for that much), and afterwards says "approve" instead of signing. The cap is the on-chain approval, so nothing can
 * spend more than was set aside, whoever says "approve". Revoke returns what is left.
 */
const storage = createMMKV({ id: APP_STORAGE_ID })
const KEY = 'cue:voice-allowance'
export const DEFAULT_ALLOWANCE_SOL = 0.5

/** Whose wallet the allowance is on; background commands act for this wallet. Null when voice approvals are off. */
export const $voiceAllowance = atom<{ owner: string } | null>(load())

function load() {
  try {
    const raw = storage.getString(KEY)
    return raw ? (JSON.parse(raw) as { owner: string }) : null
  } catch {
    return null
  }
}

export function setVoiceAllowance(value: { owner: string } | null) {
  if (value) storage.set(KEY, JSON.stringify(value))
  else storage.remove(KEY)
  $voiceAllowance.set(value)
}

/** What voice approvals can still spend: the approved allowance, minus what waiting buy rules have set aside. */
export function allowanceLeft(): bigint {
  const approved = $delegatedLamports.get()
  if (!$voiceAllowance.get() || approved === null) return 0n
  const left = approved - activeBuyLamports()
  return left > 0n ? left : 0n
}

export const voiceApprovalsOn = () => $voiceAllowance.get() !== null && $delegatedLamports.get() !== null
