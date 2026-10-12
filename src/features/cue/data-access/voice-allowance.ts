import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { type Address, address } from '@solana/kit'

import { activeCluster } from '@/features/cluster/data-access/active-client'
import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { getSessionKey } from '@/features/cue/data-access/session-key'
import {
  activeBuyLamports,
  delegatedLamports,
  setDelegatedLamports,
} from '@/features/price-triggers/data-access/trigger-store'
import { findAtaAddress, NATIVE_MINT_ADDRESS } from '@/features/wallet/util/spl-token'

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

/** Wrapped SOL `holder` has in its own wrapped-SOL account (0 when it has none). */
export async function wsolHeld(client: SolanaClient, holder: Address): Promise<bigint> {
  const ata = await findAtaAddress(holder, NATIVE_MINT_ADDRESS)
  return client.rpc
    .getTokenAccountBalance(ata, { commitment: 'confirmed' })
    .send()
    .then((r) => BigInt(r.value.amount))
    .catch(() => 0n) // no account means nothing held
}

type ParsedTokenAccount = { delegate?: string; delegatedAmount?: { amount: string }; tokenAmount: { amount: string } }

/**
 * The wallet's SOL as the chain has it, all of it the user's: plain SOL, the wrapped SOL set aside for Cue in their own
 * account (`approved` of it spendable by Cue's key), and what Cue's key holds for them (fees, a buy in progress).
 */
export async function solOnChain(client: SolanaClient, owner: string) {
  const key = await getSessionKey()
  const ownerWsol = await findAtaAddress(address(owner), NATIVE_MINT_ADDRESS)
  const [plain, wrappedAccount, keySol, keyWsol] = await Promise.all([
    client.rpc
      .getBalance(address(owner), { commitment: 'confirmed' })
      .send()
      .then((r) => r.value),
    client.rpc
      .getAccountInfo(ownerWsol, { commitment: 'confirmed', encoding: 'jsonParsed' })
      .send()
      .then((r) => (r.value?.data as { parsed?: { info?: ParsedTokenAccount } } | undefined)?.parsed?.info ?? null),
    key
      ? client.rpc
          .getBalance(key.address, { commitment: 'confirmed' })
          .send()
          .then((r) => r.value)
      : 0n,
    key ? wsolHeld(client, key.address) : 0n,
  ])
  const wrapped = BigInt(wrappedAccount?.tokenAmount.amount ?? 0)
  const delegated =
    key && wrappedAccount?.delegate === key.address ? BigInt(wrappedAccount.delegatedAmount?.amount ?? 0) : 0n
  const approved = delegated < wrapped ? delegated : wrapped
  return { approved, cueHolds: keySol + keyWsol, plain, total: plain + wrapped + keySol + keyWsol, wrapped }
}

/**
 * Reads `owner`'s SOL from the chain and sets what Cue may spend to what it says, so the app's own count can't drift
 * from the real approval. Only while voice approvals are on for that wallet: turning them on or off stays the user's
 * choice in Settings.
 */
export async function syncAllowance(
  client: SolanaClient,
  owner: string | undefined = voiceAllowance()?.owner,
  clusterId: string = activeCluster().id,
) {
  if (!owner) return null
  const sol = await solOnChain(client, owner)
  if (voiceAllowance(clusterId)?.owner === owner && delegatedLamports(clusterId) !== null) {
    setDelegatedLamports(sol.approved, clusterId)
  }
  return sol
}
