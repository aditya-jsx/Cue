import { useStore } from '@nanostores/react'
import { getExplorerUrl } from '@wallet-ui/react-native-kit'
import * as Linking from 'expo-linking'
import { useState } from 'react'
import { Pressable, ScrollView } from 'react-native'
import Animated, { FadeInDown, LinearTransition } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { $cue, plainText } from '@/features/cue/data-access/cue-store'
import { onCluster } from '@/features/price-triggers/data-access/trigger-store'
import { useCue } from '@/features/cue/cue-theme'
import { CuePage, Row, Rows, Txt } from '@/features/cue/ui/cue-ui'

function timeAgo(at: number | undefined): string {
  if (!at) return 'Earlier'
  const minutes = Math.floor((Date.now() - at) / 60_000)
  if (minutes < 1) return 'Just now'
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`
  return new Date(at).toLocaleDateString([], { day: 'numeric', month: 'short' })
}

// Entries saved before timestamps existed baked a stale "Just now" into their text.
const legacyDetail = (detail: string) => detail.replace(/^Just now(, | — )?/, '')

export function CueActivity() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { cluster } = useAppCluster()
  // This network's activity only: devnet test sends shouldn't sit between real mainnet buys.
  const log = useStore($cue).log.filter((l) => onCluster(l, cluster.id))
  const [expanded, setExpanded] = useState<string | null>(null)
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
            {log.length === 0 ? (
              <Txt style={{ fontSize: 15, paddingVertical: 22, textAlign: 'center' }} v="sub">
                {`Nothing on ${cluster.label} yet.`}
              </Txt>
            ) : null}
            {log.map((l, i) => (
              <Animated.View entering={FadeInDown.duration(500)} key={l.id} layout={LinearTransition}>
                <Pressable
                  accessibilityRole={l.signature ? 'link' : 'button'}
                  // With a transaction: open it in the explorer. Without one: show the whole message.
                  onPress={() => (l.signature ? open(l.signature) : setExpanded(expanded === l.id ? null : l.id))}
                >
                  <Row
                    detail={[timeAgo(l.at), plainText(l.at ? l.detail : legacyDetail(l.detail))]
                      .filter(Boolean)
                      .join(' · ')}
                    detailLines={expanded === l.id ? undefined : 2}
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
