import Ionicons from '@expo/vector-icons/Ionicons'
import { useStore } from '@nanostores/react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { ScrollView, View } from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { $cue, flow, SUGGESTIONS } from '@/features/cue/data-access/cue-store'
import { useCue } from '@/features/cue/cue-theme'
import { CuePage, Glass, Press, Ring, Row, Rows, SectionLabel, Txt } from '@/features/cue/ui/cue-ui'
import { useGetBalance } from '@/features/wallet/data-access/use-get-balance'

const LAMPORTS = 1_000_000_000n
const enter = (i: number) => FadeInDown.delay(i * 55).duration(550)

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
  const { rules } = useStore($cue)
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
                  <Row detail={r.detail} last={i === rules.length - 1} title={r.title} />
                </Animated.View>
              ))
            ) : (
              <Txt style={{ fontSize: 15, paddingVertical: 22, textAlign: 'center' }} v="sub">
                No rules yet. Try saying one below.
              </Txt>
            )}
          </Rows>
        </Animated.View>

        <Animated.View entering={enter(3)}>
          <SectionLabel>Try saying</SectionLabel>
        </Animated.View>
        <Animated.View entering={enter(4)} style={{ marginHorizontal: -20 }}>
          <ScrollView
            contentContainerStyle={{ gap: 8, paddingHorizontal: 20 }}
            horizontal
            showsHorizontalScrollIndicator={false}
          >
            {SUGGESTIONS.map((s) => (
              <Press key={s.key} label={s.label} onPress={() => flow.startListening(s.key)}>
                <Glass radius={999} style={{ paddingHorizontal: 15, paddingVertical: 9 }}>
                  <Txt style={{ fontSize: 14 }}>{s.label}</Txt>
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
          <Press label="Talk to Cue" onPress={() => flow.startListening('send')}>
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
