import Ionicons from '@expo/vector-icons/Ionicons'
import { useStore } from '@nanostores/react'
import { useQuery } from '@tanstack/react-query'
import * as Clipboard from 'expo-clipboard'
import { useEffect, useState } from 'react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { router } from 'expo-router'
import { Alert, RefreshControl, ScrollView, View } from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { $homeNotice, $question, flow, SUGGESTIONS } from '@/features/cue/data-access/cue-store'
import { answerQuestion, tokenHoldings } from '@/features/cue/util/answer'
import { speak } from '@/features/cue/util/speech'
import { $prices } from '@/features/prices/data-access/price-store'
import { mainnetRpc, skrNamesOf } from '@/features/cue/data-access/skr'
import { $voiceAllowances, allowanceLeft, voiceApprovalsOn } from '@/features/cue/data-access/voice-allowance'
import {
  $delegations,
  $triggers,
  cancelTrigger,
  describeTrigger,
  onCluster,
} from '@/features/price-triggers/data-access/trigger-store'
import { useCue } from '@/features/cue/cue-theme'
import { CuePage, Glass, Press, Ring, Row, Rows, SectionLabel, Txt } from '@/features/cue/ui/cue-ui'
import { useGetBalance } from '@/features/wallet/data-access/use-get-balance'

const LAMPORTS = 1_000_000_000n
const enter = (i: number) => FadeInDown.delay(i * 55).duration(550)
const MANUAL = [
  { icon: 'arrow-up-circle-outline', kind: 'send', label: 'Send' },
  { icon: 'trending-down-outline', kind: 'buy', label: 'Buy' },
  { icon: 'shield-checkmark-outline', kind: 'guard', label: 'Guard' },
] as const

function confirmCancel(id: string, title: string) {
  Alert.alert('Cancel this rule?', title, [
    { style: 'cancel', text: 'Keep it' },
    { onPress: () => cancelTrigger(id), style: 'destructive', text: 'Cancel rule' },
  ])
}

function formatSol(lamports: bigint) {
  const whole = lamports / LAMPORTS
  const frac = (lamports % LAMPORTS).toString().padStart(9, '0').slice(0, 4).replace(/0+$/, '')
  return `${whole.toLocaleString()}${frac ? `.${frac}` : ''}`
}

/** Answers a spoken question out loud and puts the answer in the Home banner; nothing slides up. */
function useAnswerQuestions(owner: string) {
  const question = useStore($question)
  const { client, cluster } = useAppCluster()
  useEffect(() => {
    if (!question) return
    $question.set(null)
    const rules = $triggers.get().filter((t) => t.status === 'active' && onCluster(t, cluster.id))
    answerQuestion({
      client,
      owner,
      prices: $prices.get(),
      question: question.question,
      rules,
      symbol: question.symbol,
    })
      .then((a) => {
        speak(a.spoken)
        $homeNotice.set({ canEdit: false, reason: a.text, text: question.text })
      })
      .catch(() => {
        const sorry = "I couldn't check that right now. Try again in a moment."
        speak(sorry)
        $homeNotice.set({ canEdit: false, reason: sorry, text: question.text })
      })
  }, [client, cluster.id, owner, question])
}

export function CueHome() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { account } = useMobileWallet()
  const { client, cluster } = useAppCluster()
  const rules = useStore($triggers).filter((t) => t.status === 'active' && onCluster(t, cluster.id))
  const notice = useStore($homeNotice)
  const [copied, setCopied] = useState(false)
  const prices = useStore($prices)
  // Only the tokens Cue understands (it can price, watch and buy them); a wallet's spam airdrops stay in Phantom.
  const { data: tokens, refetch: refetchTokens } = useQuery({
    queryFn: () => tokenHoldings(client, account!.address),
    queryKey: ['cue-tokens', cluster.id, account!.address.toString()],
    staleTime: 30_000,
  })
  const held = Object.entries(tokens ?? {})
    .filter(([, amount]) => amount > 0)
    .map(([symbol, amount]) => {
      const price = prices[symbol as keyof typeof prices]
      return { amount, symbol, usd: price ? amount * price.usd : null }
    })
  useStore($voiceAllowances) // re-render when voice approvals are turned on or off
  useStore($delegations) // ...or spent from
  useStore($triggers)
  const voiceOn = voiceApprovalsOn()
  const solLeft = Number((Number(allowanceLeft()) / 1e9).toFixed(4)).toString()
  useAnswerQuestions(account!.address)
  const balance = useGetBalance(account!.address)
  const value = balance.data?.value
  const address = account!.address.toString()
  // The user's Seeker name, shown beside (never instead of) the address: anyone can send a name to any wallet.
  const { data: skrName, refetch: refetchSkrName } = useQuery({
    queryFn: () => skrNamesOf(mainnetRpc, account!.address).then((names) => names[0] ?? null),
    queryKey: ['skr-name', address],
    retry: false,
    staleTime: 60 * 60_000,
  })
  const tabBarTop = insets.bottom + 14 + 68

  return (
    <CuePage>
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabBarTop + 200, paddingHorizontal: 20 }}
        refreshControl={
          // Pull down to re-read the balance (and the .skr name) straight from the chain.
          <RefreshControl
            colors={[c.text]}
            onRefresh={() => void Promise.all([balance.refetch(), refetchSkrName(), refetchTokens()])}
            progressBackgroundColor={c.bg}
            refreshing={balance.isRefetching}
            tintColor={c.text}
          />
        }
        showsVerticalScrollIndicator={false}
      >
        <Animated.View
          entering={enter(0)}
          style={{
            alignItems: 'center',
            flexDirection: 'row',
            justifyContent: 'space-between',
            marginBottom: 18,
            marginTop: 14,
            paddingHorizontal: 4,
          }}
        >
          <Txt style={{ fontSize: 22, fontWeight: '700', letterSpacing: -0.66 }}>Cue</Txt>
          {/* Tap to copy the full address, e.g. to receive funds. */}
          <Press
            label="Copy wallet address"
            onPress={() => {
              void Clipboard.setStringAsync(address)
              setCopied(true)
              setTimeout(() => setCopied(false), 1500)
            }}
          >
            <Glass radius={999} style={{ paddingHorizontal: 13, paddingVertical: 7 }}>
              <Txt v="mono">
                {copied ? 'Copied' : `${skrName ? `${skrName} · ` : ''}${address.slice(0, 4)}…${address.slice(-4)}`}
              </Txt>
            </Glass>
          </Press>
        </Animated.View>

        {notice ? (
          <Animated.View entering={FadeInDown.duration(350)} layout={LinearTransition} style={{ marginBottom: 14 }}>
            <Glass radius={22} style={{ gap: 6, paddingHorizontal: 18, paddingVertical: 14 }}>
              <View style={{ alignItems: 'flex-start', flexDirection: 'row', gap: 10 }}>
                <Ionicons color={c.muted} name="chatbubble-ellipses-outline" size={18} style={{ marginTop: 2 }} />
                <View style={{ flex: 1, gap: 4 }}>
                  {notice.text ? <Txt v="k">{`You said “${notice.text}”`}</Txt> : null}
                  <Txt style={{ fontSize: 15 }}>{notice.reason}</Txt>
                  {notice.canEdit ? (
                    <Press
                      label="Fill in the rest"
                      onPress={() => {
                        $homeNotice.set(null)
                        flow.edit()
                      }}
                    >
                      <Txt style={{ color: c.accent, fontWeight: '600', marginTop: 4 }}>Fill in the rest</Txt>
                    </Press>
                  ) : null}
                </View>
                <Press label="Dismiss" onPress={() => $homeNotice.set(null)}>
                  <Ionicons color={c.muted} name="close" size={18} />
                </Press>
              </View>
            </Glass>
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(1)}>
          <Glass radius={30} style={{ paddingBottom: 20, paddingHorizontal: 22, paddingTop: 22 }}>
            <Txt v="k">Balance</Txt>
            <Txt
              style={{
                fontSize: 46,
                fontVariant: ['tabular-nums'],
                fontWeight: '700',
                letterSpacing: -2.07,
                lineHeight: 46,
                marginTop: 8,
              }}
            >
              {value !== undefined ? formatSol(value) : balance.isError ? 'Unavailable' : '...'}
              {value !== undefined ? (
                <Txt style={{ color: c.muted, fontSize: 20, fontWeight: '500', letterSpacing: 0 }}> SOL</Txt>
              ) : null}
            </Txt>
            <View
              style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', marginTop: 12 }}
            >
              <Txt v="mono">{cluster.label}</Txt>
              {/* What Cue may spend by voice here, or how to let it: the hook into going fully voice-controlled. */}
              <Press
                label={voiceOn ? 'Voice allowance' : 'Set up voice approvals'}
                onPress={() => router.push('/settings')}
              >
                <Txt style={{ color: voiceOn ? c.muted : c.text, fontWeight: voiceOn ? '400' : '600' }} v="k">
                  {voiceOn ? `Cue can spend ${solLeft} SOL by voice` : 'Voice approvals off · Set up'}
                </Txt>
              </Press>
            </View>
          </Glass>
        </Animated.View>

        {held.length ? (
          <Animated.View entering={enter(2)}>
            <SectionLabel>Tokens</SectionLabel>
            <Rows>
              {held.map((t, i) => (
                <Row
                  key={t.symbol}
                  last={i === held.length - 1}
                  right={<Txt v="num">{t.usd !== null ? `$${t.usd.toFixed(2)}` : '—'}</Txt>}
                  title={`${t.amount.toLocaleString(undefined, { maximumFractionDigits: 4 })} ${t.symbol}`}
                />
              ))}
            </Rows>
          </Animated.View>
        ) : null}

        <Animated.View entering={enter(2)}>
          <SectionLabel>Active rules</SectionLabel>
          <Rows>
            {rules.length ? (
              rules.map((r, i) => (
                <Animated.View entering={FadeInDown.duration(500)} key={r.id} layout={LinearTransition}>
                  <Row
                    detail={describeTrigger(r).detail}
                    last={i === rules.length - 1}
                    right={
                      <Press
                        label={`Cancel ${describeTrigger(r).title}`}
                        onPress={() => confirmCancel(r.id, describeTrigger(r).title)}
                      >
                        <Ionicons color={c.muted} name="close-circle" size={22} />
                      </Press>
                    }
                    title={describeTrigger(r).title}
                  />
                </Animated.View>
              ))
            ) : (
              <Txt style={{ fontSize: 15, paddingVertical: 22, textAlign: 'center' }} v="sub">
                No rules yet. Say one, or set one up below.
              </Txt>
            )}
          </Rows>
        </Animated.View>

        <Animated.View entering={enter(3)}>
          <SectionLabel>Do it yourself</SectionLabel>
          <View style={{ flexDirection: 'row', gap: 10 }}>
            {MANUAL.map((m) => (
              <View key={m.kind} style={{ flex: 1 }}>
                <Press label={m.label} onPress={() => flow.openCompose(m.kind)}>
                  <Glass radius={22} style={{ alignItems: 'center', gap: 8, paddingVertical: 16 }}>
                    <Ionicons color={c.text} name={m.icon} size={22} />
                    <Txt style={{ fontSize: 14, fontWeight: '600' }}>{m.label}</Txt>
                  </Glass>
                </Press>
              </View>
            ))}
          </View>
        </Animated.View>

        <Animated.View entering={enter(4)}>
          <SectionLabel>Or try saying</SectionLabel>
        </Animated.View>
        <Animated.View entering={enter(5)} style={{ marginHorizontal: -20 }}>
          <ScrollView
            contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {SUGGESTIONS.map((text) => (
              <Press key={text} label={text} onPress={() => flow.startListening(text)}>
                <Glass radius={999} style={{ paddingHorizontal: 15, paddingVertical: 9 }}>
                  <Txt style={{ fontSize: 14 }}>{text}</Txt>
                </Glass>
              </Press>
            ))}
          </ScrollView>
        </Animated.View>
      </ScrollView>

      <Animated.View
        entering={enter(6)}
        pointerEvents="box-none"
        style={{ alignItems: 'center', bottom: tabBarTop + 30, left: 0, position: 'absolute', right: 0 }}
      >
        <View style={{ alignItems: 'center', height: 76, justifyContent: 'center', width: 76 }}>
          <Ring size={76} />
          <Ring delay={1400} size={76} />
          <Press label="Talk to Cue" onPress={flow.startLiveListening}>
            <View
              style={{
                alignItems: 'center',
                backgroundColor: c.accent,
                borderRadius: 38,
                height: 76,
                justifyContent: 'center',
                width: 76,
              }}
            >
              <Ionicons color={c.onAccent} name="mic" size={30} />
            </View>
          </Press>
        </View>
      </Animated.View>
    </CuePage>
  )
}
