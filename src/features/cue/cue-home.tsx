import Ionicons from '@expo/vector-icons/Ionicons'
import { useStore } from '@nanostores/react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { ScrollView, View } from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { flow, SUGGESTIONS } from '@/features/cue/data-access/cue-store'
import { $triggers, cancelTrigger, describeTrigger } from '@/features/price-triggers/data-access/trigger-store'
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

function formatSol(lamports: bigint) {
  const whole = lamports / LAMPORTS
  const frac = (lamports % LAMPORTS).toString().padStart(9, '0').slice(0, 4).replace(/0+$/, '')
  return `${whole.toLocaleString()}${frac ? `.${frac}` : ''}`
}

export function CueHome() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { account } = useMobileWallet()
  const { cluster } = useAppCluster()
  const rules = useStore($triggers).filter((t) => t.status === 'active')
  const balance = useGetBalance(account!.address)
  const value = balance.data?.value
  const address = account!.address.toString()
  const tabBarTop = insets.bottom + 14 + 68

  return (
    <CuePage>
      <ScrollView
        contentContainerStyle={{ paddingBottom: tabBarTop + 200, paddingHorizontal: 20 }}
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
          <Glass radius={999} style={{ paddingHorizontal: 13, paddingVertical: 7 }}>
            <Txt v="mono">{`${address.slice(0, 4)}…${address.slice(-4)}`}</Txt>
          </Glass>
        </Animated.View>

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
            <Txt style={{ marginTop: 12 }} v="mono">
              {cluster.label}
            </Txt>
          </Glass>
        </Animated.View>

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
                      <Press label={`Cancel ${describeTrigger(r).title}`} onPress={() => cancelTrigger(r.id)}>
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
