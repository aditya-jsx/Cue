import Ionicons from '@expo/vector-icons/Ionicons'
import { useStore } from '@nanostores/react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Link } from 'expo-router'
import { Alert, AppState, Pressable, ScrollView, StyleSheet, TextInput, View } from 'react-native'
import Animated, {
  FadeInDown,
  FadeOutLeft,
  LinearTransition,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useEffect, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { identity } from '@/features/core/data-access/app-providers'
import { $cue, actions, flow, pushLogEntry, removeContact, shortAddr } from '@/features/cue/data-access/cue-store'
import {
  $delegations,
  delegatedLamports,
  onCluster,
  $triggers,
  activeBuyLamports,
  setDelegatedLamports,
  stopBuyTriggers,
} from '@/features/price-triggers/data-access/trigger-store'
import { SPRING, useCue } from '@/features/cue/cue-theme'
import { POLL_STATS_KEY } from '@/features/prices/data-access/price-engine-task'
import { describePollStats, type PollStats } from '@/features/prices/util/poll-stats'
import { createMMKV } from 'react-native-mmkv'
import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { askBackgroundAccess, isBackgroundAllowed } from '@/features/cue/util/background-access'
import { resetOnboarding } from '@/features/cue/data-access/onboarding'
import { deleteAllCueData } from '@/features/cue/util/delete-data'
import { $spoken, $voice, type CueVoice, setSpoken, setVoice } from '@/features/cue/util/speech'
import { CueButton, CuePage, Press, Row, Rows, SectionLabel, Segment, Txt } from '@/features/cue/ui/cue-ui'
import { setTheme, type Theme, useTheme } from '@/features/shell/data-access/use-theme'
import { executeDelegationGrant, executeDelegationRevoke } from '@/features/wallet/util/execute-delegation'
import { findAtaAddress, NATIVE_MINT_ADDRESS } from '@/features/wallet/util/spl-token'
import { getSessionKey } from '@/features/cue/data-access/session-key'
import { address } from '@solana/kit'
import { useGetBalance } from '@/features/wallet/data-access/use-get-balance'
import {
  $voiceAllowances,
  allowanceLeft,
  DEFAULT_ALLOWANCE_SOL,
  setVoiceAllowance,
  voiceAllowance,
  wsolHeld,
} from '@/features/cue/data-access/voice-allowance'
import { formatError } from '@/features/wallet/util/format-error'
import CueNative from '../../../modules/cue-native'

const THEMES: readonly Theme[] = ['dark', 'light', 'system']
const VOICE_OPTIONS: readonly CueVoice[] = ['female', 'male']
const enter = (i: number) => FadeInDown.delay(i * 55).duration(550)

const LAMPORTS = 1_000_000_000
const solAmount = (lamports: bigint) => Number((Number(lamports) / LAMPORTS).toFixed(4)).toString()
// What turning voice approvals on needs besides the allowance: Cue's fee money, the wrapped-SOL account's rent, the fee.
const SETUP_RESERVE_SOL = 0.013

/** Voice approvals: set an allowance once (one wallet signature), then say "approve" instead of signing. */
function VoiceApprovalRows({ last }: { last: boolean }) {
  const c = useCue()
  const { account } = useMobileWallet()
  const { client, cluster } = useAppCluster()
  const queryClient = useQueryClient()
  useStore($voiceAllowances)
  const allowance = voiceAllowance(cluster.id)
  useStore($delegations) // re-render as the allowance is spent
  useStore($triggers)
  const balance = useGetBalance(account!.address).data?.value
  const max = balance === undefined ? null : Math.max(0, Number(balance) / LAMPORTS - SETUP_RESERVE_SOL)
  const [amount, setAmount] = useState(String(DEFAULT_ALLOWANCE_SOL))
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (allowance) {
    return (
      <Row
        detail={`${(Number(allowanceLeft()) / LAMPORTS).toFixed(4)} SOL left to spend by voice · Revoke returns it`}
        last={last}
        right={<RevokeButton />}
        title="Voice approvals on"
      />
    )
  }

  async function turnOn() {
    if (!account || busy) return
    const sol = Number(amount.replace(',', '.'))
    if (!(sol > 0)) return setError('Enter how much SOL Cue may spend by voice.')
    if (max !== null && sol > max) return setError(`You can set aside up to ${max.toFixed(4)} SOL.`)
    setBusy(true)
    setError(null)
    try {
      const lamports = BigInt(Math.round(sol * LAMPORTS))
      // The approval covers buy rules already waiting too: a new approval replaces the old one.
      const approve = lamports + activeBuyLamports()
      const result = await executeDelegationGrant({
        account,
        approveAmountLamports: approve,
        chain: cluster.id,
        client,
        identity,
        wrapAmountLamports: lamports,
      })
      setDelegatedLamports(approve)
      setVoiceAllowance({ owner: account.address }, cluster.id)
      pushLogEntry({
        amount: `${sol} SOL`,
        detail: 'Say "approve" instead of signing, up to this much',
        signature: result.signature,
        status: 'Confirmed',
        title: 'Voice approvals on',
      })
      await queryClient.invalidateQueries({ queryKey: ['get-balance'] })
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <View
      style={{
        borderBottomColor: c.sep,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2, // same divider as a Row
        paddingVertical: 14,
      }}
    >
      <Txt style={{ fontSize: 17, fontWeight: '600' }}>Voice approvals</Txt>
      <Txt style={{ marginTop: 4 }} v="sub">
        Say “approve” instead of signing. Cue can only spend what you set aside here, and Revoke gives back what’s left.
      </Txt>
      <View style={{ alignItems: 'center', flexDirection: 'row', gap: 10, marginTop: 14 }}>
        <TextInput
          accessibilityLabel="Allowance in SOL"
          keyboardType="decimal-pad"
          onChangeText={setAmount}
          placeholder="0.5"
          placeholderTextColor={c.muted}
          style={{
            backgroundColor: c.sep,
            borderRadius: 14,
            color: c.text,
            flex: 1,
            fontSize: 17,
            paddingHorizontal: 14,
            paddingVertical: 10,
          }}
          value={amount}
        />
        <Txt v="sub">SOL</Txt>
        <Press label="Use the most I can" onPress={() => max !== null && setAmount(String(Number(max.toFixed(4))))}>
          <Txt style={{ fontWeight: '600' }}>Max</Txt>
        </Press>
      </View>
      {max !== null ? (
        <Txt style={{ marginTop: 6 }} v="k">{`Up to ${max.toFixed(4)} SOL (keeps a little for fees)`}</Txt>
      ) : null}
      {error ? (
        <Txt style={{ marginTop: 8 }} v="k">
          {error}
        </Txt>
      ) : null}
      <View style={{ marginTop: 14 }}>
        <CueButton
          label="Turn on"
          loading={busy}
          loadingLabel="Waiting for your wallet"
          onPress={() => void turnOn()}
        />
      </View>
    </View>
  )
}

/**
 * What Cue holds for this wallet on this network, read from the chain rather than from Cue's own notes: the session
 * key's SOL and wrapped SOL, and any spending permission left on the wallet's wrapped-SOL account. Lamports.
 */
function useCueHoldings(owner: string | undefined) {
  const { client, cluster } = useAppCluster()
  return useQuery({
    enabled: Boolean(owner),
    queryFn: async () => {
      const key = await getSessionKey()
      const [sessionSol, sessionWsol, ownerWsol] = await Promise.all([
        key
          ? client.rpc
              .getBalance(key.address, { commitment: 'confirmed' })
              .send()
              .then((r) => r.value)
          : 0n,
        key ? wsolHeld(client, key.address) : 0n,
        client.rpc
          .getAccountInfo(await findAtaAddress(address(owner!), NATIVE_MINT_ADDRESS), {
            commitment: 'confirmed',
            encoding: 'base64',
          })
          .send()
          .then((r) => r.value !== null),
      ])
      return { ownerWsolOpen: ownerWsol, total: sessionSol + sessionWsol }
    },
    queryKey: ['cue-holdings', cluster.id, owner],
    staleTime: 15_000,
  })
}

function RevokeButton() {
  const c = useCue()
  const { account } = useMobileWallet()
  const { client, cluster } = useAppCluster()
  const queryClient = useQueryClient()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRevoke() {
    if (!account) return
    setLoading(true)
    setError(null)
    try {
      const signature = await executeDelegationRevoke({
        account,
        chain: cluster.id,
        client,
        identity,
      })
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['cue-holdings'] }),
        queryClient.invalidateQueries({ queryKey: ['get-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['get-transaction-signatures'] }),
      ])
      setDelegatedLamports(null)
      // Only this network's voice allowance ended; one on another network is untouched.
      setVoiceAllowance(null, cluster.id)
      const stopped = stopBuyTriggers('Permission revoked')
      pushLogEntry({
        amount: '—',
        detail: `${stopped ? `Stopped ${stopped} buy rule${stopped === 1 ? '' : 's'}. ` : ''}Wrapped SOL returned to your wallet`,
        signature: signature || undefined, // empty when only the session key had to give funds back
        status: 'Confirmed',
        title: 'Permission revoked',
      })
    } catch (err) {
      console.error('[CueRevoke] Revocation error:', err)
      setError(formatError(err))
    } finally {
      setLoading(false)
    }
  }

  return (
    <View style={{ alignItems: 'flex-end', gap: 4 }}>
      <Press label="Revoke permission" onPress={handleRevoke}>
        <View
          style={{
            alignItems: 'center',
            borderColor: c.line,
            borderRadius: 999,
            borderWidth: 1,
            height: 36,
            justifyContent: 'center',
            opacity: loading ? 0.6 : 1,
            paddingHorizontal: 16,
          }}
        >
          <Txt style={{ fontSize: 14, fontWeight: '600' }}>{loading ? 'Revoking...' : 'Revoke'}</Txt>
        </View>
      </Press>
      {error ? (
        <Txt style={{ maxWidth: 140, textAlign: 'right' }} v="k">
          {error}
        </Txt>
      ) : null}
    </View>
  )
}

/** Shows whether Android will keep Cue running with the screen off, and lets the user fix it. */
function BackgroundRow() {
  const [allowed, setAllowed] = useState(isBackgroundAllowed)
  // The system dialog is a separate screen, so re-check when the app comes back to the front.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state === 'active') setAllowed(isBackgroundAllowed())
    })
    return () => sub.remove()
  }, [])
  return (
    <Pressable accessibilityRole="button" disabled={allowed} onPress={askBackgroundAccess}>
      <Row
        detail={allowed ? 'Rules keep running with the screen off' : 'Android may pause your rules. Tap to allow.'}
        last
        right={<Txt v="sub">{allowed ? 'On' : 'Allow'}</Txt>}
        title="Run in background"
      />
    </Pressable>
  )
}

/** Dev builds: what the background price service has done, for checking a screen-off soak. Tap to refresh. */
function PollStatsRow() {
  const read = () => {
    const raw = createMMKV({ id: APP_STORAGE_ID }).getString(POLL_STATS_KEY)
    return describePollStats(raw ? (JSON.parse(raw) as PollStats) : null, Date.now())
  }
  const [text, setText] = useState(read)
  return (
    <Pressable accessibilityRole="button" onPress={() => setText(read())}>
      <Row detail={text} title="Background polls" />
    </Pressable>
  )
}

/** Offers the "Talk to Cue" Quick Settings tile; Android shows its own add-tile prompt. */
function TileRow() {
  const [status, setStatus] = useState<string | null>(null)
  async function add() {
    const result = await CueNative.requestAddTile().catch(() => -1)
    // Android's answer codes: 2 added, 1 already there, 0 declined; anything else means it couldn't ask.
    setStatus(
      result === 2 || result === 1
        ? 'Added. Swipe down from anywhere and tap it to talk.'
        : result === 0
          ? 'Not added.'
          : 'Add it yourself: Quick Settings, edit, then drag in "Talk to Cue".',
    )
  }
  return (
    <Pressable accessibilityRole="button" onPress={() => void add()}>
      <Row
        detail={status ?? 'One swipe down from any app, and Cue is listening'}
        last
        right={<Txt v="sub">Add</Txt>}
        title="Quick Settings tile"
      />
    </Pressable>
  )
}

function Toggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useCue()
  const knob = useAnimatedStyle(() => ({
    transform: [{ translateX: withSpring(on ? 20 : 0, SPRING) }],
  }))
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="switch"
      accessibilityState={{ checked: on }}
      onPress={onPress}
    >
      <View
        style={{
          backgroundColor: on ? c.accent : c.sep,
          borderRadius: 16,
          height: 32,
          justifyContent: 'center',
          padding: 2,
          width: 52,
        }}
      >
        <Animated.View
          style={[{ backgroundColor: on ? c.onAccent : '#FFFFFF', borderRadius: 14, height: 28, width: 28 }, knob]}
        />
      </View>
    </Pressable>
  )
}

/**
 * Devnet (free test SOL) or Mainnet (real SOL). Both run through Cue's own server, so there's nothing to configure;
 * each network keeps its own rules, permissions and activity. Moving to real money asks first.
 */
function NetworkSwitch() {
  const { cluster, clusters, setCluster } = useAppCluster()
  const options = clusters.filter((c) => c.isEnabled)
  if (options.length < 2) return null
  const choose = (i: number) => {
    const next = options[i]
    if (!next || next.id === cluster.id) return
    if (next.id !== 'solana:mainnet') return setCluster(next.id)
    Alert.alert(
      'Use real SOL?',
      'On Mainnet, sends and buys spend real money. Your Devnet rules and activity stay on Devnet.',
      [
        { style: 'cancel', text: 'Stay on Devnet' },
        { onPress: () => setCluster(next.id), text: 'Switch to Mainnet' },
      ],
    )
  }
  return (
    <>
      <Segment
        onChange={choose}
        options={options.map((c) => (c.id === 'solana:mainnet' ? 'Mainnet · real SOL' : 'Devnet · test SOL'))}
        value={Math.max(
          0,
          options.findIndex((c) => c.id === cluster.id),
        )}
      />
    </>
  )
}

function LinkRow({ href, label }: { href: '/tools'; label: string }) {
  const c = useCue()
  return (
    <Link asChild href={href}>
      <Pressable accessibilityRole="button">
        <Row right={<Ionicons color={c.muted} name="chevron-forward" size={18} />} title={label} />
      </Pressable>
    </Link>
  )
}

/** Wipes Cue's data from this phone, after explaining what it does and doesn't remove. */
/**
 * Networks where Cue still has permission to spend, or still holds funds: deleting the session key there would strand
 * them, so they have to be revoked first. Checks every network, not just the one on screen.
 */
function networksToRevoke(currentId: string, holdsHere: boolean): string[] {
  const ids = new Set(Object.keys($delegations.get()))
  for (const id of Object.keys($voiceAllowances.get())) ids.add(id)
  if (holdsHere) ids.add(currentId)
  return [...ids].map((id) => (id === 'solana:mainnet' ? 'Mainnet' : 'Devnet'))
}

function confirmDeleteData(revokeOn: string[], disconnect: () => Promise<void>) {
  if (revokeOn.length) {
    Alert.alert(
      'Revoke first',
      `Cue still has permission or holds funds on ${revokeOn.join(' and ')}. Switch there under Network and tap Revoke, then delete your data.`,
    )
    return
  }
  Alert.alert(
    'Delete my data?',
    "This removes your contacts, activity, rules and settings from this phone and disconnects your wallet. It doesn't move any funds.",
    [
      { style: 'cancel', text: 'Keep it' },
      {
        onPress: () => {
          void deleteAllCueData()
            .then(() => disconnect())
            .catch((e) => console.warn('[CueDelete] failed', e))
        },
        style: 'destructive',
        text: 'Delete',
      },
    ],
  )
}

export function CueSettings() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { activeTheme } = useTheme()
  const { contacts, wake } = useStore($cue)
  useStore($delegations)
  useStore($voiceAllowances)
  const { cluster } = useAppCluster()
  const delegated = delegatedLamports(cluster.id)
  const { account: wallet } = useMobileWallet()
  const { data: holdings } = useCueHoldings(wallet?.address)
  const cueHolds = holdings?.total ?? 0n
  const sameNetworkAllowance = voiceAllowance(cluster.id) !== null
  const spoken = useStore($spoken)
  const voice = useStore($voice)
  const buyRules = useStore($triggers).filter(
    (t) => t.kind === 'buy' && t.status === 'active' && onCluster(t, cluster.id),
  ).length
  const { disconnect } = useMobileWallet()

  return (
    <CuePage>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 130, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={enter(0)}>
          <Txt style={{ marginBottom: 18, marginLeft: 4, marginTop: 18 }} v="large">
            Settings
          </Txt>
        </Animated.View>

        <Animated.View entering={enter(1)}>
          <SectionLabel first>Permissions</SectionLabel>
          {/* One card: voice approvals, then what Cue may spend or still holds on this network. */}
          <Rows>
            <VoiceApprovalRows last={sameNetworkAllowance} />
            {sameNetworkAllowance ? null : delegated !== null || cueHolds > 5_000n || holdings?.ownerWsolOpen ? (
              <Animated.View exiting={FadeOutLeft.duration(260)} layout={LinearTransition}>
                <Row
                  detail={
                    buyRules
                      ? `${buyRules} buy rule${buyRules === 1 ? '' : 's'} waiting · Revoke returns everything`
                      : 'Revoke returns everything Cue holds'
                  }
                  last
                  right={<RevokeButton />}
                  title={
                    delegated
                      ? `Can spend up to ${solAmount(delegated)} SOL`
                      : `Cue holds ${solAmount(cueHolds)} SOL for you`
                  }
                />
              </Animated.View>
            ) : (
              <Txt style={{ fontSize: 15, paddingVertical: 18, textAlign: 'center' }} v="sub">
                {`Nothing else granted on ${cluster.label}.`}
              </Txt>
            )}
          </Rows>
        </Animated.View>

        <Animated.View entering={enter(2)}>
          <SectionLabel>Network</SectionLabel>
          <NetworkSwitch />
          <SectionLabel>Background</SectionLabel>
          <Rows>
            <BackgroundRow />
          </Rows>
          <SectionLabel>Listening</SectionLabel>
          <Rows>
            <Row
              detail={'Say "Hey Cue" from anywhere'}
              right={<Toggle label="Wake word" on={wake} onPress={actions.toggleWake} />}
              title="Wake word"
            />
            <Row
              detail="Cue says back what it understood"
              right={<Toggle label="Spoken replies" on={spoken} onPress={() => setSpoken(!spoken)} />}
              title="Spoken replies"
            />
            <Row
              right={
                <Segment
                  onChange={(i) => setVoice(VOICE_OPTIONS[i])}
                  options={['Female', 'Male']}
                  style={{ width: 180 }}
                  value={VOICE_OPTIONS.indexOf(voice)}
                />
              }
              title="Voice"
            />
            <TileRow />
          </Rows>
        </Animated.View>

        <Animated.View entering={enter(3)}>
          <SectionLabel>Contacts</SectionLabel>
          <Rows>
            {contacts.map((p) => (
              <Row
                key={p.address}
                right={
                  <View style={{ alignItems: 'center', flexDirection: 'row', gap: 12 }}>
                    <Txt v="mono">{shortAddr(p.address)}</Txt>
                    <Press label={`Remove ${p.name}`} onPress={() => removeContact(p.address)}>
                      <Ionicons color={c.muted} name="close-circle" size={22} />
                    </Press>
                  </View>
                }
                title={p.name}
              />
            ))}
            {contacts.length === 0 ? (
              <Txt style={{ fontSize: 15, paddingVertical: 18, textAlign: 'center' }} v="sub">
                No contacts yet. Add one to send by name.
              </Txt>
            ) : null}
            <Pressable accessibilityRole="button" onPress={flow.openContact}>
              <Row last title={<Txt style={{ fontWeight: '500' }}>Add contact</Txt>} />
            </Pressable>
          </Rows>
        </Animated.View>

        <Animated.View entering={enter(4)}>
          <SectionLabel>Appearance</SectionLabel>
          <Segment
            onChange={(i) => setTheme(THEMES[i])}
            options={['Dark', 'Light', 'System']}
            value={Math.max(0, THEMES.indexOf(activeTheme))}
          />
        </Animated.View>

        <Animated.View entering={enter(5)}>
          <SectionLabel>App</SectionLabel>
          <Rows>
            {__DEV__ ? (
              <>
                <LinkRow href="/tools" label="Developer tools" />
                <PollStatsRow />
                <Pressable accessibilityRole="button" onPress={resetOnboarding}>
                  <Row title="Show introduction again" />
                </Pressable>
              </>
            ) : null}
            <Pressable
              accessibilityRole="button"
              onPress={() =>
                confirmDeleteData(
                  networksToRevoke(cluster.id, cueHolds > 5_000n || Boolean(holdings?.ownerWsolOpen)),
                  disconnect,
                )
              }
            >
              <Row detail="Removes your contacts, activity and rules from this phone" title="Delete my data" />
            </Pressable>
            <Pressable accessibilityRole="button" onPress={() => void disconnect()}>
              <Row last title="Disconnect wallet" />
            </Pressable>
          </Rows>
        </Animated.View>
      </ScrollView>
    </CuePage>
  )
}
