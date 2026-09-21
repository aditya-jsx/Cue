import Ionicons from '@expo/vector-icons/Ionicons'
import { useStore } from '@nanostores/react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Link } from 'expo-router'
import { Pressable, ScrollView, View } from 'react-native'
import Animated, {
  FadeInDown,
  FadeOutLeft,
  LinearTransition,
  useAnimatedStyle,
  withSpring,
} from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { $cue, actions, shortAddr } from '@/features/cue/data-access/cue-store'
import { SPRING, useCue } from '@/features/cue/cue-theme'
import { CuePage, Press, Row, Rows, SectionLabel, Segment, Txt } from '@/features/cue/ui/cue-ui'
import { setTheme, type Theme, useTheme } from '@/features/shell/data-access/use-theme'

const THEMES: readonly Theme[] = ['dark', 'light', 'system']
const enter = (i: number) => FadeInDown.delay(i * 55).duration(550)

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

function LinkRow({ href, label }: { href: '/settings/cluster' | '/tools'; label: string }) {
  const c = useCue()
  return (
    <Link asChild href={href}>
      <Pressable accessibilityRole="button">
        <Row right={<Ionicons color={c.muted} name="chevron-forward" size={18} />} title={label} />
      </Pressable>
    </Link>
  )
}

export function CueSettings() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { activeTheme } = useTheme()
  const { contacts, rules, wake } = useStore($cue)
  const { disconnect } = useMobileWallet()
  const delegated = rules.filter((r) => r.delegated)

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
          <Rows>
            {delegated.length ? (
              delegated.map((r, i) => (
                <Animated.View exiting={FadeOutLeft.duration(260)} key={r.id} layout={LinearTransition}>
                  <Row
                    detail="Ends Oct 4"
                    last={i === delegated.length - 1}
                    right={
                      <Press label={`Revoke ${r.title}`} onPress={() => actions.revoke(r.id)}>
                        <View
                          style={{
                            alignItems: 'center',
                            borderColor: c.line,
                            borderRadius: 999,
                            borderWidth: 1,
                            height: 36,
                            justifyContent: 'center',
                            paddingHorizontal: 16,
                          }}
                        >
                          <Txt style={{ fontSize: 14, fontWeight: '600' }}>Revoke</Txt>
                        </View>
                      </Press>
                    }
                    title={r.title}
                  />
                </Animated.View>
              ))
            ) : (
              <Txt style={{ fontSize: 15, paddingVertical: 22, textAlign: 'center' }} v="sub">
                Nothing granted. Cue asks first, once.
              </Txt>
            )}
          </Rows>
        </Animated.View>

        <Animated.View entering={enter(2)}>
          <SectionLabel>Listening</SectionLabel>
          <Rows>
            <Row
              detail={'Say "Hey Cue" from anywhere'}
              last
              right={<Toggle label="Wake word" on={wake} onPress={actions.toggleWake} />}
              title="Wake word"
            />
          </Rows>
        </Animated.View>

        <Animated.View entering={enter(3)}>
          <SectionLabel>Contacts</SectionLabel>
          <Rows>
            {contacts.map((p) => (
              <Row key={p.name} right={<Txt v="mono">{shortAddr(p.address)}</Txt>} title={p.name} />
            ))}
            <Row last title={<Txt style={{ fontWeight: '500' }}>Add contact</Txt>} />
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
            <LinkRow href="/settings/cluster" label="Network" />
            <LinkRow href="/tools" label="Developer tools" />
            <Pressable accessibilityRole="button" onPress={() => void disconnect()}>
              <Row last title="Disconnect wallet" />
            </Pressable>
          </Rows>
        </Animated.View>
      </ScrollView>
    </CuePage>
  )
}
