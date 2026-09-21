import Ionicons from '@expo/vector-icons/Ionicons'
import type { BottomTabBarProps } from 'expo-router/js-tabs'
import { type ComponentProps, useEffect, useState } from 'react'
import { View } from 'react-native'
import Animated, { useAnimatedStyle, useSharedValue, withSpring } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SPRING, useCue } from '@/features/cue/cue-theme'
import { Glass, Press, Txt } from '@/features/cue/ui/cue-ui'

const TABS = [
  { icon: 'home', label: 'Home', name: 'index' },
  { icon: 'list', label: 'Activity', name: 'activity' },
  { icon: 'options', label: 'Settings', name: 'settings' },
] as const

function TabIcon({ color, name, on }: { color: string; name: ComponentProps<typeof Ionicons>['name']; on: boolean }) {
  const scale = useSharedValue(1)
  useEffect(() => {
    scale.set(withSpring(on ? 1.1 : 1, SPRING))
  }, [on, scale])
  const style = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Animated.View style={style}>
      <Ionicons color={color} name={name} size={24} />
    </Animated.View>
  )
}

export function CueTabBar({ navigation, state }: BottomTabBarProps) {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const [width, setWidth] = useState(0)
  const active = Math.max(
    0,
    TABS.findIndex((t) => t.name === state.routes[state.index]?.name),
  )
  const x = useSharedValue(0)
  const cell = width > 0 ? (width - 12) / TABS.length : 0

  useEffect(() => {
    x.set(withSpring(active * cell, SPRING))
  }, [active, cell, x])

  const pill = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))

  return (
    <View pointerEvents="box-none" style={{ bottom: insets.bottom + 14, left: 22, position: 'absolute', right: 22 }}>
      <Glass radius={34} strong style={{ flexDirection: 'row', height: 68, padding: 6 }}>
        <View onLayout={(e) => setWidth(e.nativeEvent.layout.width + 12)} style={{ flexDirection: 'row', flex: 1 }}>
          <Animated.View
            style={[
              {
                backgroundColor: c.fill,
                borderColor: c.line,
                borderRadius: 28,
                borderWidth: 1,
                bottom: 0,
                position: 'absolute',
                top: 0,
                width: cell,
              },
              pill,
            ]}
          />
          {TABS.map((t, i) => {
            const on = i === active
            return (
              <View key={t.name} style={{ flex: 1 }}>
                <Press
                  label={t.label}
                  onPress={() => {
                    if (!on) navigation.navigate(t.name)
                  }}
                  style={{ alignItems: 'center', height: 56, justifyContent: 'center', gap: 3 }}
                >
                  <TabIcon color={on ? c.text : c.muted} name={on ? t.icon : (`${t.icon}-outline` as const)} on={on} />
                  <Txt style={{ color: on ? c.text : c.muted, fontSize: 11, fontWeight: '500' }}>{t.label}</Txt>
                </Press>
              </View>
            )
          })}
        </View>
      </Glass>
    </View>
  )
}
