import Ionicons from '@expo/vector-icons/Ionicons'
import { useStore } from '@nanostores/react'
import { type ReactNode, useEffect, useState } from 'react'
import {
  Pressable,
  ScrollView,
  StyleSheet,
  TextInput,
  type TextInputProps,
  useWindowDimensions,
  View,
} from 'react-native'
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
import {
  $cue,
  $flow,
  activateBuy,
  activateGuard,
  addContact,
  type ComposeKind,
  flow,
  recordSend,
  resumeWakeWord,
  type Screen,
  speechHints,
  shortAddr,
} from '@/features/cue/data-access/cue-store'
import {
  activeBuyLamports,
  formatUsd,
  type GuardAction,
  type TriggerDirection,
} from '@/features/price-triggers/data-access/trigger-store'
import { shouldFireTrigger } from '@/features/price-triggers/util/should-fire-trigger'
import type { Draft } from '@/features/cue/data-access/understand'
import { $prices, type Symbol } from '@/features/prices/data-access/price-store'
import CueNative from '../../../modules/cue-native'
import { executeDelegationGrant } from '@/features/wallet/util/execute-delegation'
import { executeInstantSend } from '@/features/wallet/util/execute-instant-send'
import { formatError } from '@/features/wallet/util/format-error'
import { IOS_EASING, useCue } from '@/features/cue/cue-theme'
import { Backdrop, CueButton, Glass, KV, Press, Ring, Rows, Segment, Txt } from '@/features/cue/ui/cue-ui'

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
      {has('compose') && !has('confirm') && !has('nope') ? <Compose key="compose" /> : null}
      {has('contact') ? <AddContact key="contact" /> : null}
      {has('listen') ? <Listening covered={has('confirm') || has('nope')} key="listen" /> : null}
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

function Listening({ covered }: { covered: boolean }) {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { engine, live, micBlocked, notice, text } = useStore($flow)
  const words = text.split(' ').filter(Boolean)
  const [shown, setShown] = useState(0)
  const [thinking, setThinking] = useState(false)
  // A sheet slides over this screen, and its glass is see-through, so the listening content fades out beneath it.
  const fade = useAnimatedStyle(() => ({ opacity: withTiming(covered ? 0 : 1, { duration: 450 }) }))

  // Scripted phrase: reveal word-by-word on a fixed timer, then auto-parse.
  useEffect(() => {
    if (live) return
    const t: ReturnType<typeof setTimeout>[] = []
    words.forEach((_, i) => t.push(setTimeout(() => setShown(i + 1), 500 + i * 180)))
    const end = 500 + words.length * 180 + 350
    t.push(setTimeout(() => setThinking(true), end))
    t.push(setTimeout(() => void flow.finishListening(text), end + 900))
    return () => t.forEach(clearTimeout)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  // Gemini engine: record the clip, let the assistant hear and parse it. The clip ends on its own when the user stops
  // talking; the wake-word service is paused for the recording (one mic client at a time) and handed the mic back after.
  useEffect(() => {
    if (!live || engine !== 'gemini') return
    CueNative.stopWakeWordService()
    CueNative.startAudioCapture()
    let cancelled = false
    const subs = [
      CueNative.addListener('onAudioCaptured', ({ wav }) => {
        if (cancelled) return
        setThinking(true)
        resumeWakeWord()
        void flow.finishAudio(wav).then((reached) => {
          if (reached || cancelled) return
          setThinking(false)
          flow.useAndroidFallback()
        })
      }),
      CueNative.addListener('onAudioError', ({ message }) => {
        if (cancelled) return
        resumeWakeWord()
        // Nothing said within the window: close quietly. Anything else (mic busy) hands over to Android's recognizer.
        if (message === 'nospeech') flow.cancel()
        else flow.useAndroidFallback()
      }),
    ]
    return () => {
      cancelled = true
      subs.forEach((sub) => sub.remove())
      CueNative.stopAudioCapture()
      resumeWakeWord()
    }
  }, [engine, live])

  // Android engine (fallback): live transcript streams in via the store as the user speaks, shown as it arrives.
  useEffect(() => {
    if (!live || engine !== 'android') return
    // The wake-word service holds the mic continuously (AudioRecord), which starves SpeechRecognizer
    // ("not connected to the recognition service") if both run at once — free the mic for it, then
    // hand it back once this utterance's result/error arrives (starting it is a no-op if it's already
    // running, so re-arming it from multiple places here is safe).
    CueNative.stopWakeWordService()
    CueNative.startSpeechRecognition(speechHints())
    let cancelled = false
    // "Understanding" stays up while Claude reads the transcript; the store drops the answer if the user cancels.
    const finish = (text: string) => {
      if (cancelled) return
      setThinking(true)
      resumeWakeWord()
      void flow.finishListening(text)
    }
    const subs = [
      CueNative.addListener('onSpeechPartial', ({ text }) => {
        if (!cancelled) flow.setTranscript(text)
      }),
      CueNative.addListener('onSpeechResult', ({ text }) => finish(text)),
      CueNative.addListener('onSpeechError', ({ message }) => {
        // 6 = heard nothing at all, 7 = heard something it couldn't transcribe. Nothing said (or a wake-word false
        // alarm) isn't worth an error sheet; a garbled attempt after tapping the mic is.
        const code = Number(/\((\d+)\)/.exec(message)?.[1])
        if (!cancelled && code === 9) {
          flow.blockMic() // 9 = no microphone permission
          return
        }
        if (!cancelled && (code === 6 || (code === 7 && $flow.get().source === 'wake'))) {
          resumeWakeWord()
          flow.cancel()
          return
        }
        finish('')
      }),
    ]
    return () => {
      cancelled = true
      subs.forEach((s) => s.remove())
      CueNative.stopSpeechRecognition()
      resumeWakeWord()
    }
  }, [engine, live])

  const visibleWords = live ? words : words.slice(0, shown)

  // Vertical positions are proportional to the 844pt prototype so any phone height keeps the same composition.
  const at = (y: number) => (y / 844) * height

  return (
    <Animated.View
      entering={ZoomIn.duration(420).easing(ease)}
      exiting={FadeOut.duration(220)}
      style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}
    >
      <Backdrop />
      <Animated.View pointerEvents={covered ? 'none' : 'auto'} style={[StyleSheet.absoluteFill, fade]}>
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
          {visibleWords.length === 0 && notice ? (
            <Txt style={{ textAlign: 'center' }} v="sub">
              {notice}
            </Txt>
          ) : null}
          {visibleWords.map((w, i) => (
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
          {micBlocked ? (
            <View style={{ marginBottom: 12 }}>
              <CueButton label="Open settings" onPress={() => void Linking.openSettings()} />
            </View>
          ) : null}
          <CueButton label="Cancel" onPress={flow.cancel} variant="glass" />
        </View>
      </Animated.View>
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
const wsol = (lamports: bigint) => `${(Number(lamports) / LAMPORTS_PER_SOL).toFixed(4)} WSOL`
const when = (ms: number) => new Date(ms).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })
const moves = (direction: 'above' | 'below') => (direction === 'below' ? 'falls' : 'rises')

function useRefreshWallet() {
  const queryClient = useQueryClient()
  return () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['get-balance'] }),
      queryClient.invalidateQueries({ queryKey: ['get-transaction-signatures'] }),
    ])
}

function Confirm() {
  const { plan, stack, text } = useStore($flow)
  // What the assistant heard, so a misheard amount or name is caught before signing. Not shown for the manual form,
  // where the user typed the values themselves.
  const spoken = stack[0] !== 'compose' && text ? text : null
  const { account } = useMobileWallet()
  const { client, cluster } = useAppCluster()
  const refreshWallet = useRefreshWallet()
  const [error, setError] = useState<string | null>(null)
  const sendSol = useMutation({
    mutationFn: (p: { amount: number; recipient: string }) =>
      executeInstantSend({
        account: account!,
        amountLamports: BigInt(Math.round(p.amount * LAMPORTS_PER_SOL)),
        chain: cluster.id,
        client,
        destination: p.recipient,
        identity,
      }),
    onSuccess: refreshWallet,
  })

  async function sign() {
    if (plan.kind !== 'send' || sendSol.isPending) return
    setError(null)
    try {
      const signature = await sendSol.mutateAsync(plan)
      recordSend(signature)
      flow.signed(signature)
    } catch (e) {
      // A confirm-timeout still carries the real signature (it was submitted); show it so the user can verify.
      const sig = (e as { signature?: string })?.signature
      setError(sig ? `${formatError(e)}\n\nSignature: ${sig}` : formatError(e))
    }
  }

  function turnOnGuard() {
    if (!account) return
    activateGuard(account.address)
    flow.signed()
  }

  return (
    <Sheet top={104}>
      {spoken ? (
        <Animated.View entering={stagger(0)} style={{ marginBottom: 16 }}>
          <Txt v="k">You said</Txt>
          <Txt style={{ fontSize: 17, marginTop: 4 }}>{`“${spoken}”`}</Txt>
        </Animated.View>
      ) : null}
      {plan.kind === 'send' ? (
        <>
          <Animated.View entering={stagger(0)}>
            <Tag>Instant send</Tag>
          </Animated.View>
          <Animated.View entering={stagger(1)}>
            <Txt style={{ fontSize: 54, fontWeight: '700', letterSpacing: -2.43, lineHeight: 54, marginTop: 8 }}>
              {plan.amount} SOL
            </Txt>
          </Animated.View>
          <Animated.View entering={stagger(3)} style={{ marginTop: 22 }}>
            <Rows>
              <KV
                label="To"
                value={
                  <Txt style={{ fontSize: 15 }}>
                    {plan.recipientName !== shortAddr(plan.recipient) ? `${plan.recipientName} ` : ''}
                    <Txt v="mono">{shortAddr(plan.recipient)}</Txt>
                  </Txt>
                }
              />
              <KV label="Network fee" value={num('0.000005 SOL')} />
              <KV label="Signature" last value={val('Required now')} />
            </Rows>
          </Animated.View>
        </>
      ) : null}
      {plan.kind === 'buy' ? (
        <>
          <Animated.View entering={stagger(0)}>
            <Tag>Conditional buy</Tag>
          </Animated.View>
          <Animated.View entering={stagger(1)}>
            <Txt style={{ marginTop: 14 }} v="h">
              {`Buy $${plan.amountUsd} of ${plan.symbol} when it ${moves(plan.direction)} to ${formatUsd(plan.targetUsd)}`}
            </Txt>
            <Txt style={{ fontSize: 15, marginTop: 10 }} v="sub">
              {shouldFireTrigger(plan.direction, plan.priceUsd, plan.targetUsd)
                ? `${plan.symbol} is already ${plan.direction} that, so Cue will buy on its next price check.`
                : 'Cue watches the price and buys for you, even when the app is closed.'}
            </Txt>
          </Animated.View>
          <Animated.View entering={stagger(3)} style={{ marginTop: 14 }}>
            <Rows>
              <KV label="Trigger" value={num(`${plan.symbol} ${plan.direction} ${formatUsd(plan.targetUsd)}`)} />
              <KV label="Price now" value={num(formatUsd(plan.priceUsd))} />
              <KV label="Spend" value={num(`$${plan.amountUsd} ≈ ${wsol(plan.amountLamports)}`)} />
              <KV label="Expires" value={val(when(plan.expiresAt))} />
              <KV label="Permission" last value={val('Needs approval')} />
            </Rows>
          </Animated.View>
        </>
      ) : null}
      {plan.kind === 'guard' ? (
        <>
          <Animated.View entering={stagger(0)}>
            <Tag>Portfolio guard</Tag>
          </Animated.View>
          <Animated.View entering={stagger(1)}>
            <Txt style={{ marginTop: 14 }} v="h">
              {`Watch for a ${plan.thresholdPct}% drop in ${plan.timeframe === '1h' ? 'an hour' : '24 hours'}`}
            </Txt>
            <Txt style={{ fontSize: 15, marginTop: 10 }} v="sub">
              Choose what Cue does if it happens.
            </Txt>
          </Animated.View>
          <Animated.View entering={stagger(2)}>
            <Segment
              onChange={(i) => flow.setGuardAction(i ? 'pause_activity' : 'alert_only')}
              options={['Alert me', 'Pause activity']}
              style={{ marginTop: 20 }}
              value={plan.action === 'pause_activity' ? 1 : 0}
            />
            <Txt style={{ marginHorizontal: 6, marginTop: 14 }} v="k">
              {plan.action === 'pause_activity'
                ? 'Sends a notification and stops all your buy rules.'
                : 'Sends a notification. Nothing else changes.'}
            </Txt>
          </Animated.View>
          <Animated.View entering={stagger(3)} style={{ marginTop: 14 }}>
            <Rows>
              <KV label="Watching" value={val('Your SOL, in dollars')} />
              <KV label="SOL now" value={num(formatUsd(plan.baselineUsd))} />
              <KV
                label="Fires at"
                last
                value={num(`${formatUsd(plan.baselineUsd * (1 - plan.thresholdPct / 100))} or lower`)}
              />
            </Rows>
          </Animated.View>
        </>
      ) : null}
      <View style={{ flex: 1 }} />
      <Animated.View entering={stagger(5)} style={{ gap: 12, paddingTop: 18 }}>
        {error ? <Txt v="k">{error}</Txt> : null}
        {plan.kind === 'buy' ? <CueButton label="Review permission" onPress={flow.review} /> : null}
        {plan.kind === 'guard' ? <CueButton label="Turn on guard" onPress={turnOnGuard} /> : null}
        {plan.kind === 'send' ? (
          <CueButton
            label="Confirm and sign"
            loading={sendSol.isPending}
            loadingLabel="Waiting for your wallet"
            onPress={sign}
          />
        ) : null}
        <View style={{ flexDirection: 'row', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <CueButton label="Edit details" onPress={flow.edit} variant="glass" />
          </View>
          <View style={{ flex: 1 }}>
            <CueButton label="Cancel" onPress={flow.cancel} variant="glass" />
          </View>
        </View>
      </Animated.View>
    </Sheet>
  )
}

function NotSupported() {
  const { draft, plan, text } = useStore($flow)
  return (
    <Sheet>
      {text ? (
        <>
          <Txt v="k">You said</Txt>
          <Txt style={{ marginTop: 6 }} v="h">
            {text}
          </Txt>
        </>
      ) : null}
      <Txt style={{ marginTop: 10 }} v="sub">
        {`${plan.kind === 'nope' && plan.reason ? plan.reason : "I can't do that yet."} Cue can send SOL, buy on a price trigger, and guard your portfolio.`}
      </Txt>
      <View style={{ gap: 12, paddingTop: 18 }}>
        <CueButton label="Try again" onPress={flow.retry} />
        {draft ? <CueButton label="Edit details" onPress={flow.edit} variant="glass" /> : null}
        <CueButton label="Close" onPress={flow.cancel} variant="glass" />
      </View>
    </Sheet>
  )
}

/* ---------- manual entry: builds the same Intent the parser would ---------- */

function Field({ label, ...input }: TextInputProps & { label: string }) {
  const c = useCue()
  return (
    <View style={{ gap: 6, marginTop: 16 }}>
      <Txt v="k">{label}</Txt>
      <TextInput
        placeholderTextColor={c.muted}
        style={{
          backgroundColor: c.sep,
          borderRadius: 14,
          color: c.text,
          fontSize: 17,
          paddingHorizontal: 14,
          paddingVertical: 12,
        }}
        {...input}
      />
    </View>
  )
}

function Pill({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  const c = useCue()
  return (
    <Press label={label} onPress={onPress}>
      <View
        style={{ backgroundColor: on ? c.accent : c.sep, borderRadius: 999, paddingHorizontal: 16, paddingVertical: 9 }}
      >
        <Txt style={{ color: on ? c.onAccent : c.text, fontSize: 15, fontWeight: '500' }}>{label}</Txt>
      </View>
    </Press>
  )
}

const KINDS: readonly ComposeKind[] = ['send', 'buy', 'guard']
const toNumber = (s: string) => Number(s.trim().replace(',', '.'))

function Compose() {
  const { compose, draft, plan } = useStore($flow)
  const { contacts } = useStore($cue)
  const prices = useStore($prices)
  // Opened via "Edit details": start from whatever was understood instead of a blank form.
  const d: Partial<Draft> = draft ?? {}
  const [kind, setKind] = useState<ComposeKind>(compose)
  const [amount, setAmount] = useState(String((d.intent === 'instant_send' ? d.amount : d.amount_usd) ?? ''))
  const [to, setTo] = useState(
    d.intent === 'instant_send' && plan.kind === 'send' ? plan.recipientName : (d.recipient ?? contacts[0]?.name ?? ''),
  )
  const [symbol, setSymbol] = useState<Symbol>(d.token === 'SOL' ? 'SOL' : 'JUP')
  const [direction, setDirection] = useState<TriggerDirection>(d.condition ?? 'below')
  const [price, setPrice] = useState(String(d.threshold_usd ?? ''))
  const [pct, setPct] = useState(String(d.threshold_pct ?? 10))
  const [timeframe, setTimeframe] = useState<'1h' | '24h'>(d.timeframe ?? '24h')
  const [action, setAction] = useState<GuardAction>(d.action ?? 'alert_only')
  const [error, setError] = useState<string | null>(null)

  function submit() {
    setError(null)
    if (kind === 'send') {
      const sol = toNumber(amount)
      if (!(sol > 0)) return setError('Enter how much SOL to send.')
      if (!to.trim()) return setError('Pick a contact or paste an address.')
      flow.submitIntent(
        { amount: sol, intent: 'instant_send', recipient: to.trim(), token: 'SOL' },
        `Send ${sol} SOL to ${to.trim()}`,
      )
    } else if (kind === 'buy') {
      const usd = toNumber(amount)
      const target = toNumber(price)
      if (!(usd > 0)) return setError('Enter how many dollars to spend.')
      if (!(target > 0)) return setError('Enter the price that should trigger the buy.')
      flow.submitIntent(
        { amount_usd: usd, condition: direction, intent: 'conditional_buy', threshold_usd: target, token: symbol },
        `Buy $${usd} of ${symbol} ${direction} $${target}`,
      )
    } else {
      const drop = toNumber(pct)
      if (!(drop > 0 && drop < 100)) return setError('Enter a drop between 1% and 99%.')
      flow.submitIntent(
        { action, intent: 'portfolio_guard', threshold_pct: drop, timeframe },
        `${action === 'pause_activity' ? 'Pause everything' : 'Alert me'} if my portfolio drops ${drop}% ${timeframe === '1h' ? 'in an hour' : 'today'}`,
      )
    }
  }

  return (
    <Sheet top={104}>
      <ScrollView keyboardShouldPersistTaps="handled" showsVerticalScrollIndicator={false} style={{ flexGrow: 0 }}>
        <Txt v="h">Do it yourself</Txt>
        <Segment
          onChange={(i) => {
            setKind(KINDS[i])
            setError(null)
          }}
          options={['Send', 'Buy', 'Guard']}
          style={{ marginTop: 16 }}
          value={KINDS.indexOf(kind)}
        />
        {kind === 'send' ? (
          <>
            <Field
              keyboardType="decimal-pad"
              label="Amount (SOL)"
              onChangeText={setAmount}
              placeholder="0.1"
              value={amount}
            />
            <View style={{ gap: 6, marginTop: 16 }}>
              <Txt v="k">To</Txt>
              <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
                {contacts.map((ct) => (
                  <Pill key={ct.address} label={ct.name} on={to === ct.name} onPress={() => setTo(ct.name)} />
                ))}
              </View>
            </View>
            <Field
              autoCapitalize="none"
              autoCorrect={false}
              label="Or paste an address"
              onChangeText={setTo}
              placeholder="Wallet address"
              value={contacts.some((ct) => ct.name === to) ? '' : to}
            />
          </>
        ) : null}
        {kind === 'buy' ? (
          <>
            <View style={{ flexDirection: 'row', gap: 8, marginTop: 16 }}>
              {(['JUP', 'SOL'] as const).map((s) => (
                <Pill key={s} label={s} on={symbol === s} onPress={() => setSymbol(s)} />
              ))}
            </View>
            <Field
              keyboardType="decimal-pad"
              label="Spend (USD)"
              onChangeText={setAmount}
              placeholder="5"
              value={amount}
            />
            <Segment
              onChange={(i) => setDirection(i ? 'above' : 'below')}
              options={['When it falls to', 'When it rises to']}
              style={{ marginTop: 16 }}
              value={direction === 'above' ? 1 : 0}
            />
            <Field
              keyboardType="decimal-pad"
              label={`Price (USD)${prices[symbol] ? ` · now ${formatUsd(prices[symbol]!.usd)}` : ''}`}
              onChangeText={setPrice}
              placeholder="0.30"
              value={price}
            />
          </>
        ) : null}
        {kind === 'guard' ? (
          <>
            <Field
              keyboardType="decimal-pad"
              label="Alert when my portfolio drops (%)"
              onChangeText={setPct}
              value={pct}
            />
            <Segment
              onChange={(i) => setTimeframe(i ? '24h' : '1h')}
              options={['Within 1 hour', 'Within 24 hours']}
              style={{ marginTop: 16 }}
              value={timeframe === '24h' ? 1 : 0}
            />
            <Segment
              onChange={(i) => setAction(i ? 'pause_activity' : 'alert_only')}
              options={['Alert me', 'Pause activity']}
              style={{ marginTop: 12 }}
              value={action === 'pause_activity' ? 1 : 0}
            />
          </>
        ) : null}
      </ScrollView>
      <View style={{ flex: 1 }} />
      <View style={{ gap: 12, paddingTop: 18 }}>
        {error ? <Txt v="k">{error}</Txt> : null}
        <CueButton label="Continue" onPress={submit} />
        <CueButton label="Cancel" onPress={flow.cancel} variant="glass" />
      </View>
    </Sheet>
  )
}

function AddContact() {
  const [name, setName] = useState('')
  const [address, setAddress] = useState('')
  const [error, setError] = useState<string | null>(null)

  function save() {
    const problem = addContact(name, address)
    if (problem) setError(problem)
    else flow.cancel()
  }

  return (
    <Sheet top={104}>
      <Txt v="h">Add contact</Txt>
      <Field autoCapitalize="words" label="Name" onChangeText={setName} placeholder="Alex" value={name} />
      <Field
        autoCapitalize="none"
        autoCorrect={false}
        label="Wallet address"
        onChangeText={(v) => {
          setAddress(v)
          setError(null)
        }}
        placeholder="Solana address"
        value={address}
      />
      <Txt style={{ marginHorizontal: 6, marginTop: 14 }} v="k">
        Check the address carefully: a send to a wrong address cannot be undone.
      </Txt>
      <View style={{ flex: 1 }} />
      <View style={{ gap: 12, paddingTop: 18 }}>
        {error ? <Txt v="k">{error}</Txt> : null}
        <CueButton label="Save contact" onPress={save} />
        <CueButton label="Cancel" onPress={flow.cancel} variant="glass" />
      </View>
    </Sheet>
  )
}

/* ---------- permission (pushes in from the right) ---------- */

function Delegate() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { plan } = useStore($flow)
  const { account } = useMobileWallet()
  const { client, cluster } = useAppCluster()
  const refreshWallet = useRefreshWallet()
  const [error, setError] = useState<string | null>(null)
  const buy = plan.kind === 'buy' ? plan : null
  // approve() replaces the previous allowance, so it has to cover this rule plus every buy rule still waiting.
  const [others] = useState(activeBuyLamports)
  const total = others + (buy?.amountLamports ?? 0n)

  const grantDelegation = useMutation({
    mutationFn: () =>
      executeDelegationGrant({
        account: account!,
        approveAmountLamports: total,
        chain: cluster.id,
        client,
        identity,
        wrapAmountLamports: buy!.amountLamports,
      }),
    onSuccess: refreshWallet,
  })

  async function approve() {
    if (!account || !buy || grantDelegation.isPending) return
    setError(null)
    try {
      const result = await grantDelegation.mutateAsync()
      activateBuy(account.address, result.signature, total)
      flow.signed(result.signature)
    } catch (e) {
      const sig = (e as { signature?: string })?.signature
      setError(sig ? `${formatError(e)}\n\nSignature: ${sig}` : formatError(e))
    }
  }

  if (!buy) return null

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
            {`Let Cue buy ${buy.symbol} for you`}
          </Txt>
          <Txt style={{ marginBottom: 22, marginHorizontal: 4, marginTop: 10 }} v="sub">
            You approve once. Cue then acts on its own, up to this limit.
          </Txt>
        </Animated.View>
        <Animated.View entering={stagger(3)}>
          <Rows>
            <KV label="Set aside now" value={num(wsol(buy.amountLamports))} />
            <KV label="Hard limit, on-chain" value={num(wsol(total))} />
            <KV label="Cue will use it for" value={val(`Buying ${buy.symbol}`)} />
            <KV label="Session gas funded" value={num('0.01 SOL')} />
            <KV label="Stays valid until" last value={val('You revoke it')} />
          </Rows>
          <Txt style={{ marginHorizontal: 8, marginTop: 16 }} v="k">
            {`Solana itself enforces the ${wsol(total)} limit${others > 0n ? ', which also covers your other active buy rules' : ''}. Revoke any time from Settings.`}
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
  const { plan, signature } = useStore($flow)
  const { cluster } = useAppCluster()
  const explorerUrl = signature
    ? getExplorerUrl({ network: { id: cluster.id, url: cluster.url }, path: `/tx/${signature}`, provider: 'solana' })
    : null
  const [title, body] =
    plan.kind === 'send'
      ? [`Sent ${plan.amount} SOL to ${plan.recipientName}`, 'Confirmed on Solana.']
      : plan.kind === 'buy'
        ? [
            'Rule is live',
            `Cue will buy $${plan.amountUsd} of ${plan.symbol} if it ${moves(plan.direction)} to ${formatUsd(plan.targetUsd)}. Expires ${when(plan.expiresAt)}.`,
          ]
        : plan.kind === 'guard'
          ? [
              'Guard is on',
              `If your portfolio drops ${plan.thresholdPct}% within ${plan.timeframe === '1h' ? 'an hour' : '24 hours'}, ${
                plan.action === 'pause_activity' ? 'Cue pauses your buy rules and tells you.' : 'you get an alert.'
              }`,
            ]
          : ['', '']
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
            {title}
          </Txt>
          <Txt style={{ marginTop: 10, textAlign: 'center' }} v="sub">
            {body}
          </Txt>
          {signature ? (
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
