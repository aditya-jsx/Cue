import Ionicons from '@expo/vector-icons/Ionicons'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'
import { Pressable, StyleSheet, useWindowDimensions, View } from 'react-native'
import Animated, {
  Easing,
  FadeIn,
  FadeInDown,
  FadeOut,
  SlideInDown,
  SlideInRight,
  SlideOutDown,
  SlideOutRight,
  useAnimatedProps,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSequence,
  withTiming,
  ZoomIn,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'
import Svg, { Path } from 'react-native-svg'
import { getExplorerUrl, useMobileWallet } from '@wallet-ui/react-native-kit'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import * as Linking from 'expo-linking'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { identity } from '@/features/core/data-access/app-providers'
import { $flow, flow, type Screen, shortAddr } from '@/features/cue/data-access/cue-store'
import { executeDelegationGrant } from '@/features/wallet/util/execute-delegation'
import { executeInstantSend } from '@/features/wallet/util/execute-instant-send'
import { formatError } from '@/features/wallet/util/format-error'
import { IOS_EASING, useCue } from '@/features/cue/cue-theme'
import { Backdrop, CueButton, Glass, KV, Press, Ring, Rows, Segment, Txt, useBusy } from '@/features/cue/ui/cue-ui'

const ease = Easing.bezierFn(...IOS_EASING)
const SHEET_IN = SlideInDown.duration(520).easing(ease)
const SHEET_OUT = SlideOutDown.duration(320).easing(ease)
const stagger = (i: number) => FadeInDown.delay(120 + i * 55).duration(520)

/** Every layer of the flow lives here, above the tabs. Layers stack in the order they were pushed. */
export function CueFlow() {
  const { stack } = useStore($flow)
  const has = (s: Screen) => stack.includes(s)
  return (
    <View pointerEvents={stack.length ? 'auto' : 'none'} style={StyleSheet.absoluteFill}>
      {has('listen') ? <Listening key="listen" /> : null}
      {has('confirm') ? <Confirm key="confirm" /> : null}
      {has('nope') ? <NotSupported key="nope" /> : null}
      {has('delegate') ? <Delegate key="delegate" /> : null}
      {has('success') ? <Success key="success" /> : null}
    </View>
  )
}

/* ---------- listening ---------- */

function Bar({ fast, h, i }: { fast: boolean; h: number; i: number }) {
  const c = useCue()
  const s = useSharedValue(0.3)
  useEffect(() => {
    const d = fast ? 275 : 550
    s.set(
      withDelay(i * 70, withRepeat(withSequence(withTiming(1, { duration: d }), withTiming(0.3, { duration: d })), -1)),
    )
  }, [fast, i, s])
  const style = useAnimatedStyle(() => ({ transform: [{ scaleY: s.value }] }))
  return <Animated.View style={[{ backgroundColor: c.accent, borderRadius: 2, height: h, width: 4 }, style]} />
}

/** "Understanding" pulses while the intent is parsed. */
function Phase({ thinking }: { thinking: boolean }) {
  const c = useCue()
  const o = useSharedValue(1)
  useEffect(() => {
    o.set(
      thinking ? withRepeat(withSequence(withTiming(0.4, { duration: 600 }), withTiming(1, { duration: 600 })), -1) : 1,
    )
  }, [thinking, o])
  const style = useAnimatedStyle(() => ({ opacity: o.value }))
  return (
    <Animated.View style={style}>
      <Txt style={{ color: thinking ? c.text : c.muted, fontSize: 15, fontWeight: '500', textAlign: 'center' }}>
        {thinking ? 'Understanding' : 'Listening'}
      </Txt>
    </Animated.View>
  )
}

function Listening() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { text } = useStore($flow)
  const words = text.split(' ')
  const [shown, setShown] = useState(0)
  const [thinking, setThinking] = useState(false)

  useEffect(() => {
    const t: ReturnType<typeof setTimeout>[] = []
    words.forEach((_, i) => t.push(setTimeout(() => setShown(i + 1), 500 + i * 180)))
    const end = 500 + words.length * 180 + 350
    t.push(setTimeout(() => setThinking(true), end))
    t.push(setTimeout(flow.parsed, end + 900))
    return () => t.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Vertical positions are proportional to the 844pt prototype so any phone height keeps the same composition.
  const at = (y: number) => (y / 844) * height

  return (
    <Animated.View
      entering={ZoomIn.duration(420).easing(ease)}
      exiting={FadeOut.duration(220)}
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
    >
      <Backdrop />
      <View style={{ left: 0, position: 'absolute', right: 0, top: at(118) }}>
        <Phase thinking={thinking} />
      </View>
      <View style={{ alignItems: 'center', left: 0, position: 'absolute', right: 0, top: at(190) }}>
        <View style={{ alignItems: 'center', height: 200, justifyContent: 'center', width: 200 }}>
          <Ring duration={2400} from={0.4} size={248} />
          <Glass radius={100} style={{ alignItems: 'center', height: 200, justifyContent: 'center', width: 200 }}>
            <View style={{ alignItems: 'center', flexDirection: 'row', gap: 5 }}>
              {Array.from({ length: 19 }, (_, i) => (
                <Bar fast={thinking} h={18 + Math.round(Math.abs(Math.sin(i * 1.3)) * 64)} i={i} key={i} />
              ))}
            </View>
          </Glass>
        </View>
      </View>
      <View
        style={{
          flexDirection: 'row',
          flexWrap: 'wrap',
          justifyContent: 'center',
          left: 28,
          minHeight: 100,
          position: 'absolute',
          right: 28,
          top: at(470),
        }}
      >
        {words.slice(0, shown).map((w, i) => (
          <Animated.Text
            entering={FadeInDown.duration(300)}
            key={i}
            style={{ color: c.text, fontSize: 26, fontWeight: '600', letterSpacing: -0.65, lineHeight: 32.5 }}
          >
            {w}{' '}
          </Animated.Text>
        ))}
      </View>
      <View style={{ bottom: insets.bottom + 24, left: 20, position: 'absolute', right: 20 }}>
        <CueButton label="Cancel" onPress={flow.cancel} variant="glass" />
      </View>
    </Animated.View>
  )
}

/* ---------- sheets ---------- */

function Sheet({ children, top }: { children: ReactNode; top?: number }) {
  const c = useCue()
  const insets = useSafeAreaInsets()
  return (
    <View style={StyleSheet.absoluteFill}>
      <Animated.View
        entering={FadeIn.duration(350)}
        exiting={FadeOut.duration(250)}
        style={[StyleSheet.absoluteFill, { backgroundColor: c.scrim }]}
      >
        <Pressable accessibilityLabel="Dismiss" onPress={flow.cancel} style={StyleSheet.absoluteFill} />
      </Animated.View>
      <Animated.View
        entering={SHEET_IN}
        exiting={SHEET_OUT}
        style={{ bottom: 0, left: 0, position: 'absolute', right: 0, top: top ?? undefined }}
      >
        <Glass
          radius={38}
          strong
          style={{
            borderBottomLeftRadius: 0,
            borderBottomRightRadius: 0,
            flex: top ? 1 : undefined,
            paddingBottom: insets.bottom + 20,
            paddingHorizontal: 24,
            paddingTop: 10,
          }}
        >
          <View
            style={{
              alignSelf: 'center',
              backgroundColor: c.muted,
              borderRadius: 3,
              height: 5,
              marginBottom: 18,
              marginTop: 2,
              opacity: 0.5,
              width: 38,
            }}
          />
          {children}
        </Glass>
      </Animated.View>
    </View>
  )
}

function Tag({ children }: { children: string }) {
  const c = useCue()
  return (
    <View
      style={{
        alignSelf: 'flex-start',
        backgroundColor: c.sep,
        borderRadius: 999,
        paddingHorizontal: 12,
        paddingVertical: 5,
      }}
    >
      <Txt style={{ fontSize: 13, fontWeight: '500' }}>{children}</Txt>
    </View>
  )
}

const num = (t: string) => <Txt v="num">{t}</Txt>
const val = (t: string) => <Txt style={{ fontSize: 15 }}>{t}</Txt>

const LAMPORTS_PER_SOL = 1_000_000_000

function Confirm() {
  const { guardMode, intent, parsed, recipient } = useStore($flow)
  const [busy, run] = useBusy(1100)
  const { account } = useMobileWallet()
  const { client, cluster } = useAppCluster()
  const queryClient = useQueryClient()
  const sendSol = useMutation({
    mutationFn: (opts: { amountLamports: bigint; destination: string }) =>
      executeInstantSend({ account: account!, chain: cluster.id, client, identity, ...opts }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['get-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['get-transaction-signatures'] }),
      ])
    },
  })
  const [error, setError] = useState<string | null>(null)
  const send = parsed.intent === 'instant_send' && recipient ? { ...parsed, to: recipient } : null

  async function sign() {
    if (!send || sendSol.isPending) return
    setError(null)
    try {
      const signature = await sendSol.mutateAsync({
        amountLamports: BigInt(Math.round(send.amount * LAMPORTS_PER_SOL)),
        destination: send.to,
      })
      flow.signed(signature)
    } catch (e) {
      // A confirm-timeout still carries the real signature (it was submitted); show it so the user can verify.
      const sig = (e as { signature?: string })?.signature
      setError(sig ? `${formatError(e)}\n\nSignature: ${sig}` : formatError(e))
    }
  }

  return (
    <Sheet top={104}>
      {intent === 'send' && send ? (
        <>
          <Animated.View entering={stagger(0)}>
            <Tag>Instant send</Tag>
          </Animated.View>
          <Animated.View entering={stagger(1)}>
            <Txt style={{ fontSize: 54, fontWeight: '700', letterSpacing: -2.43, lineHeight: 54, marginTop: 8 }}>
              {send.amount} {send.token}
            </Txt>
          </Animated.View>
          <Animated.View entering={stagger(3)} style={{ marginTop: 22 }}>
            <Rows>
              <KV
                label="To"
                value={
                  <Txt style={{ fontSize: 15 }}>
                    {send.recipient !== send.to ? `${send.recipient} ` : ''}
                    <Txt v="mono">{shortAddr(send.to)}</Txt>
                  </Txt>
                }
              />
              <KV label="Network fee" value={num('0.000005 SOL')} />
              <KV label="Signature" last value={val('Required now')} />
            </Rows>
          </Animated.View>
        </>
      ) : null}
      {intent === 'buy' ? (
        <>
          <Animated.View entering={stagger(0)}>
            <Tag>Conditional buy</Tag>
          </Animated.View>
          <Animated.View entering={stagger(1)}>
            <Txt style={{ marginTop: 14 }} v="h">
              Buy $20 of JUP when it falls to $0.85
            </Txt>
            <Txt style={{ fontSize: 15, marginTop: 10 }} v="sub">
              Cue watches the price and buys for you, even when the app is closed.
            </Txt>
          </Animated.View>
          <Animated.View entering={stagger(3)} style={{ marginTop: 14 }}>
            <Rows>
              <KV label="Trigger" value={num('JUP below $0.85')} />
              <KV label="Spend" value={num('$20.00 USDC')} />
              <KV label="Expires" value={val('Tomorrow, 9:00 AM')} />
              <KV label="Permission" last value={val('Needs approval')} />
            </Rows>
          </Animated.View>
        </>
      ) : null}
      {intent === 'guard' ? (
        <>
          <Animated.View entering={stagger(0)}>
            <Tag>Portfolio guard</Tag>
          </Animated.View>
          <Animated.View entering={stagger(1)}>
            <Txt style={{ marginTop: 14 }} v="h">
              Watch for a 10% drop in 24 hours
            </Txt>
            <Txt style={{ fontSize: 15, marginTop: 10 }} v="sub">
              Choose what Cue does if it happens.
            </Txt>
          </Animated.View>
          <Animated.View entering={stagger(2)}>
            <Segment
              onChange={(i) => flow.setGuardMode(i as 0 | 1)}
              options={['Alert me', 'Pause activity']}
              style={{ marginTop: 20 }}
              value={guardMode}
            />
            <Txt style={{ marginHorizontal: 6, marginTop: 14 }} v="k">
              {guardMode
                ? 'Sends a notification and stops all rules until you resume them.'
                : 'Sends a notification. Nothing else changes.'}
            </Txt>
          </Animated.View>
        </>
      ) : null}
      <View style={{ flex: 1 }} />
      <Animated.View entering={stagger(5)} style={{ gap: 12, paddingTop: 18 }}>
        {error ? <Txt v="k">{error}</Txt> : null}
        {intent === 'buy' ? (
          <CueButton label="Review permission" onPress={flow.review} />
        ) : (
          <CueButton
            label={intent === 'guard' ? 'Turn on guard' : 'Confirm and sign'}
            loading={intent === 'send' ? sendSol.isPending : busy}
            loadingLabel="Waiting for your wallet"
            onPress={intent === 'send' ? sign : () => run(flow.signed)}
          />
        )}
        <CueButton label="Cancel" onPress={flow.cancel} variant="glass" />
      </Animated.View>
    </Sheet>
  )
}

function NotSupported() {
  const { parsed, text } = useStore($flow)
  const reason = parsed.intent === 'unsupported' ? parsed.reason : ''
  return (
    <Sheet>
      <Txt v="k">You said</Txt>
      <Txt style={{ marginTop: 6 }} v="h">
        {text}
      </Txt>
      <Txt style={{ marginTop: 10 }} v="sub">
        {`${reason || "I can't do that yet."} Cue can send SOL, buy on a price trigger, and guard your portfolio.`}
      </Txt>
      <View style={{ gap: 12, paddingTop: 18 }}>
        <CueButton label="Try again" onPress={flow.retry} />
        <CueButton label="Close" onPress={flow.cancel} variant="glass" />
      </View>
    </Sheet>
  )
}

/* ---------- permission (pushes in from the right) ---------- */

function Delegate() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { account } = useMobileWallet()
  const { client, cluster } = useAppCluster()
  const queryClient = useQueryClient()
  const [error, setError] = useState<string | null>(null)

  const grantDelegation = useMutation({
    mutationFn: () =>
      executeDelegationGrant({
        account: account!,
        chain: cluster.id,
        client,
        identity,
      }),
    onSuccess: async (result) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['get-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['get-transaction-signatures'] }),
      ])
      flow.signed(result.signature, {
        delegateAddress: result.delegateAddress,
        tokenAccount: result.ownerAta,
      })
    },
  })

  async function approve() {
    if (!account) {
      setError('Please connect your wallet first.')
      return
    }
    if (grantDelegation.isPending) return
    setError(null)
    try {
      await grantDelegation.mutateAsync()
    } catch (e) {
      const sig = (e as { signature?: string })?.signature
      setError(sig ? `${formatError(e)}\n\nSignature: ${sig}` : formatError(e))
    }
  }

  return (
    <Animated.View
      entering={SlideInRight.duration(480).easing(ease)}
      exiting={SlideOutRight.duration(320).easing(ease)}
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg2 }]}
    >
      <Backdrop />
      <View style={{ flex: 1, paddingHorizontal: 20, paddingTop: insets.top + 8 }}>
        <Animated.View entering={stagger(0)} style={{ alignSelf: 'flex-start' }}>
          <Press label="Back" onPress={flow.back}>
            <Glass radius={20} style={{ alignItems: 'center', height: 40, justifyContent: 'center', width: 40 }}>
              <Ionicons color={c.text} name="chevron-back" size={20} />
            </Glass>
          </Press>
        </Animated.View>
        <Animated.View entering={stagger(1)}>
          <Txt style={{ marginBottom: 0, marginLeft: 4, marginTop: 22 }} v="large">
            Let Cue buy JUP for you
          </Txt>
          <Txt style={{ marginBottom: 22, marginHorizontal: 4, marginTop: 10 }} v="sub">
            You approve once. Cue then acts on its own, up to this limit.
          </Txt>
        </Animated.View>
        <Animated.View entering={stagger(3)}>
          <Rows>
            <KV label="Hard limit, on-chain" value={num('0.05 WSOL')} />
            <KV label="Cue will use it for" value={val('Buying JUP')} />
            <KV label="Session gas funded" value={num('0.01 SOL')} />
            <KV label="Stays valid until" last value={val('You revoke it')} />
          </Rows>
          <Txt style={{ marginHorizontal: 8, marginTop: 16 }} v="k">
            Solana itself enforces the 0.05 WSOL limit. Cue funds a secure session key with 0.01 SOL for gas. Revoke any
            time from Settings.
          </Txt>
        </Animated.View>
        <View style={{ flex: 1 }} />
        <Animated.View entering={stagger(5)} style={{ gap: 12, paddingBottom: insets.bottom + 24 }}>
          {error ? <Txt v="k">{error}</Txt> : null}
          <CueButton
            label="Approve in your wallet"
            loading={grantDelegation.isPending}
            loadingLabel="Waiting for your wallet"
            onPress={approve}
          />
          <CueButton label="Not now" onPress={flow.cancel} variant="glass" />
        </Animated.View>
      </View>
    </Animated.View>
  )
}

/* ---------- success ---------- */

const AnimatedPath = Animated.createAnimatedComponent(Path)

function Tick() {
  const c = useCue()
  const draw = useSharedValue(20)
  useEffect(() => {
    draw.set(withDelay(250, withTiming(0, { duration: 550, easing: ease })))
  }, [draw])
  const props = useAnimatedProps(() => ({ strokeDashoffset: draw.value }))
  return (
    <Animated.View entering={ZoomIn.duration(450).easing(ease)}>
      <Glass radius={46} style={{ alignItems: 'center', height: 92, justifyContent: 'center', width: 92 }}>
        <Svg height={44} viewBox="0 0 24 24" width={44}>
          <AnimatedPath
            animatedProps={props}
            d="M5 12.5l4.5 4.5L19 7.5"
            fill="none"
            stroke={c.text}
            strokeDasharray="20"
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={2.6}
          />
        </Svg>
      </Glass>
    </Animated.View>
  )
}

function Success() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { guardMode, intent, parsed, recipient, signature } = useStore($flow)
  const { cluster } = useAppCluster()
  const explorerUrl = signature
    ? getExplorerUrl({ network: { id: cluster.id, url: cluster.url }, path: `/tx/${signature}`, provider: 'solana' })
    : null
  const sent = parsed.intent === 'instant_send' ? parsed : null
  const copy = {
    buy: ['Rule is live', 'Cue will buy $20 of JUP if it falls to $0.85. Expires tomorrow, 9:00 AM.'],
    guard: [
      'Guard is on',
      guardMode
        ? 'If your portfolio drops 10% in 24 hours, Cue pauses all rules and tells you.'
        : 'If your portfolio drops 10% in 24 hours, you get an alert.',
    ],
    nope: ['', ''],
    send: [
      sent
        ? `Sent ${sent.amount} ${sent.token} to ${recipient && sent.recipient === recipient ? shortAddr(recipient) : sent.recipient}`
        : 'Sent',
      'Confirmed on Solana.',
    ],
  }[intent]
  return (
    <Animated.View
      entering={ZoomIn.duration(420).easing(ease)}
      exiting={FadeOut.duration(220)}
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
    >
      <Backdrop />
      <View
        style={{ alignItems: 'center', flex: 1, justifyContent: 'center', paddingBottom: 60, paddingHorizontal: 32 }}
      >
        <Tick />
        <Animated.View entering={stagger(2)} style={{ alignItems: 'center', marginTop: 28 }}>
          <Txt style={{ textAlign: 'center' }} v="h">
            {copy[0]}
          </Txt>
          <Txt style={{ marginTop: 10, textAlign: 'center' }} v="sub">
            {copy[1]}
          </Txt>
          {intent === 'send' && signature ? (
            <Txt style={{ marginTop: 2, textAlign: 'center' }} v="sub">
              <Txt v="mono">{shortAddr(signature)}</Txt>
            </Txt>
          ) : null}
        </Animated.View>
      </View>
      <View style={{ bottom: insets.bottom + 24, gap: 12, left: 20, position: 'absolute', right: 20 }}>
        {explorerUrl ? (
          <CueButton label="View transaction" onPress={() => void Linking.openURL(explorerUrl)} variant="glass" />
        ) : null}
        <CueButton label="Done" onPress={flow.done} />
      </View>
    </Animated.View>
  )
}
