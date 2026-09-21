import { useStore } from '@nanostores/react'
import { getExplorerUrl } from '@wallet-ui/react-native-kit'
import * as Linking from 'expo-linking'
import { Pressable, ScrollView } from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { $cue } from '@/features/cue/data-access/cue-store'
import { useCue } from '@/features/cue/cue-theme'
import { CuePage, Row, Rows, Txt } from '@/features/cue/ui/cue-ui'

export function CueActivity() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { log } = useStore($cue)
  const { cluster } = useAppCluster()
  const open = (signature: string) =>
    void Linking.openURL(
      getExplorerUrl({ network: { id: cluster.id, url: cluster.url }, path: `/tx/${signature}`, provider: 'solana' }),
    )

  return (
    <CuePage>
      <ScrollView
        contentContainerStyle={{ paddingBottom: insets.bottom + 130, paddingHorizontal: 20 }}
        showsVerticalScrollIndicator={false}
      >
        <Animated.View entering={FadeInDown.duration(550)}>
          <Txt style={{ marginBottom: 18, marginLeft: 4, marginTop: 18 }} v="large">
            Activity
          </Txt>
        </Animated.View>
        <Animated.View entering={FadeInDown.delay(60).duration(550)}>
          <Rows>
            {log.map((l, i) => (
              <Animated.View entering={FadeInDown.duration(500)} key={l.id} layout={LinearTransition}>
                <Pressable
                  accessibilityRole={l.signature ? 'link' : undefined}
                  disabled={!l.signature}
                  onPress={() => l.signature && open(l.signature)}
                >
                  <Row
                    detail={l.detail}
                    last={i === log.length - 1}
                    right={<Txt v="num">{l.amount}</Txt>}
                    rightSub={
                      <Txt
                        style={{
                          color: l.status === 'Alert' ? c.text : c.muted,
                          fontWeight: l.status === 'Alert' ? '600' : '400',
                        }}
                        v="k"
                      >
                        {l.status}
                      </Txt>
                    }
                    title={l.title}
                  />
                </Pressable>
              </Animated.View>
            ))}
          </Rows>
        </Animated.View>
      </ScrollView>
    </CuePage>
  )
}
