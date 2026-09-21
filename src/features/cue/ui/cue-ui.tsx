import { type ComponentProps, type ReactNode, useEffect, useState } from 'react'
import {
  ActivityIndicator,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  type TextProps,
  View,
  type ViewStyle,
} from 'react-native'
import Animated, {
  Easing,
  useAnimatedStyle,
  useSharedValue,
  withDelay,
  withRepeat,
  withSpring,
  withTiming,
} from 'react-native-reanimated'
import Svg, { Defs, RadialGradient, Rect, Stop } from 'react-native-svg'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { SPRING, useCue } from '@/features/cue/cue-theme'

/** Translucent surface with a hairline border and a top highlight. No blur, so it costs nothing on Android. */
export function Glass({
  children,
  radius = 26,
  strong,
  style,
}: {
  children?: ReactNode
  radius?: number
  strong?: boolean
  style?: ViewStyle
}) {
  const c = useCue()
  return (
    <View
      style={[
        {
          backgroundColor: strong ? c.glassStrong : c.glass,
          borderColor: c.line,
          borderRadius: radius,
          borderWidth: StyleSheet.hairlineWidth * 2,
          overflow: 'hidden',
        },
        style,
      ]}
    >
      <View
        pointerEvents="none"
        style={{
          backgroundColor: c.highlight,
          height: 1,
          left: radius * 0.6,
          position: 'absolute',
          right: radius * 0.6,
          top: 0,
        }}
      />
      {children}
    </View>
  )
}

/** Soft grey glow behind everything, so the glass has something to sit on. */
export function Backdrop() {
  const c = useCue()
  return (
    <View pointerEvents="none" style={[StyleSheet.absoluteFill, { backgroundColor: c.bg }]}>
      <Svg height="100%" width="100%">
        <Defs>
          <RadialGradient cx="15%" cy="12%" id="g1" r="60%">
            <Stop offset="0" stopColor={c.glow} stopOpacity="0.28" />
            <Stop offset="1" stopColor={c.glow} stopOpacity="0" />
          </RadialGradient>
          <RadialGradient cx="95%" cy="55%" id="g2" r="55%">
            <Stop offset="0" stopColor={c.glow} stopOpacity="0.16" />
            <Stop offset="1" stopColor={c.glow} stopOpacity="0" />
          </RadialGradient>
        </Defs>
        <Rect fill="url(#g1)" height="100%" width="100%" />
        <Rect fill="url(#g2)" height="100%" width="100%" />
      </Svg>
    </View>
  )
}

/** Pressable that squeezes on touch and springs back. Every tap in the app goes through this. */
export function Press({
  children,
  disabled,
  label,
  onPress,
  style,
}: {
  children: ReactNode
  disabled?: boolean
  label?: string
  onPress?: () => void
  style?: ViewStyle
}) {
  const scale = useSharedValue(1)
  const animated = useAnimatedStyle(() => ({ transform: [{ scale: scale.value }] }))
  return (
    <Pressable
      accessibilityLabel={label}
      accessibilityRole="button"
      disabled={disabled}
      onPress={onPress}
      onPressIn={() => {
        scale.set(withTiming(0.95, { duration: 90 }))
      }}
      onPressOut={() => {
        scale.set(withSpring(1, SPRING))
      }}
    >
      <Animated.View style={[style, animated]}>{children}</Animated.View>
    </Pressable>
  )
}

const mono = Platform.select({ android: 'monospace', default: 'Menlo' })
const variants = {
  body: { fontSize: 16 },
  h: { fontSize: 26, fontWeight: '700', letterSpacing: -0.8, lineHeight: 30 },
  hero: { fontSize: 40, fontWeight: '700', letterSpacing: -1.4, lineHeight: 42 },
  k: { fontSize: 13, muted: true },
  large: { fontSize: 34, fontWeight: '700', letterSpacing: -1, lineHeight: 38 },
  num: { fontFamily: mono, fontSize: 15, fontVariant: ['tabular-nums'] },
  mono: { fontFamily: mono, fontSize: 13, fontVariant: ['tabular-nums'], muted: true },
  sub: { fontSize: 16, muted: true },
} as const

export function Txt({ style, v = 'body', ...rest }: TextProps & { v?: keyof typeof variants }) {
  const c = useCue()
  const { muted, ...base } = variants[v] as (typeof variants)[keyof typeof variants] & { muted?: boolean }
  return <Text {...rest} style={[{ color: muted ? c.muted : c.text }, base as object, style]} />
}

export function CueButton({
  label,
  loading,
  loadingLabel,
  onPress,
  variant = 'primary',
}: {
  label: string
  loading?: boolean
  loadingLabel?: string
  onPress: () => void
  variant?: 'glass' | 'primary'
}) {
  const c = useCue()
  const primary = variant === 'primary'
  const fg = primary ? c.onAccent : c.text
  return (
    <Press disabled={loading} label={label} onPress={onPress}>
      <View
        style={{
          alignItems: 'center',
          backgroundColor: primary ? c.accent : c.glass,
          borderColor: primary ? 'transparent' : c.line,
          borderRadius: 999,
          borderWidth: StyleSheet.hairlineWidth * 2,
          flexDirection: 'row',
          gap: 10,
          height: 54,
          justifyContent: 'center',
        }}
      >
        {loading ? <ActivityIndicator color={fg} size="small" /> : null}
        <Text style={{ color: fg, fontSize: 17, fontWeight: '600', letterSpacing: -0.2 }}>
          {loading && loadingLabel ? loadingLabel : label}
        </Text>
      </View>
    </Press>
  )
}

/** Full-screen page with safe-area padding and the shared backdrop. */
export function CuePage({ children }: { children: ReactNode }) {
  const insets = useSafeAreaInsets()
  return (
    <View style={{ flex: 1, paddingTop: insets.top + 8 }}>
      <Backdrop />
      {children}
    </View>
  )
}

export function Rows({ children }: { children: ReactNode }) {
  return <Glass style={{ paddingHorizontal: 18, paddingVertical: 4 }}>{children}</Glass>
}

export function Row({
  detail,
  last,
  right,
  rightSub,
  title,
}: {
  detail?: string
  last?: boolean
  right?: ReactNode
  rightSub?: ReactNode
  title: ReactNode
}) {
  const c = useCue()
  return (
    <View
      style={{
        alignItems: 'center',
        borderBottomColor: c.sep,
        borderBottomWidth: last ? 0 : StyleSheet.hairlineWidth * 2,
        flexDirection: 'row',
        gap: 14,
        justifyContent: 'space-between',
        paddingVertical: 14,
      }}
    >
      <View style={{ flex: 1 }}>
        {typeof title === 'string' ? <Txt style={{ fontSize: 16 }}>{title}</Txt> : title}
        {detail ? (
          <Txt style={{ marginTop: 2 }} v="k">
            {detail}
          </Txt>
        ) : null}
      </View>
      {right || rightSub ? (
        <View style={{ alignItems: 'flex-end' }}>
          {right}
          {rightSub}
        </View>
      ) : null}
    </View>
  )
}

export function SectionLabel({ children, first }: { children: string; first?: boolean }) {
  return (
    <Txt style={{ fontWeight: '500', marginBottom: 8, marginLeft: 8, marginTop: first ? 0 : 26 }} v="k">
      {children}
    </Txt>
  )
}

/** Local state hook for buttons that fake work for a moment. Returns [busy, run]. */
export function useBusy(ms: number): [boolean, (done: () => void) => void] {
  const [busy, setBusy] = useState(false)
  return [
    busy,
    (done) => {
      if (busy) return
      setBusy(true)
      setTimeout(() => {
        setBusy(false)
        done()
      }, ms)
    },
  ]
}

export type IconName = ComponentProps<typeof import('@expo/vector-icons/Ionicons').default>['name']

/** Label and value row used by confirm and permission screens: small muted label, 15pt value. */
export function KV({ label, last, value }: { label: string; last?: boolean; value: ReactNode }) {
  return <Row last={last} right={value} title={<Txt v="k">{label}</Txt>} />
}

/** Expanding ring that fades out. Used behind the mic and the listening orb. */
export function Ring({
  delay = 0,
  duration = 2800,
  size,
  from = 0.55,
}: {
  delay?: number
  duration?: number
  from?: number
  size: number
}) {
  const c = useCue()
  const t = useSharedValue(0)
  useEffect(() => {
    t.set(withDelay(delay, withRepeat(withTiming(1, { duration, easing: Easing.out(Easing.quad) }), -1)))
  }, [delay, duration, t])
  const style = useAnimatedStyle(() => ({ opacity: from * (1 - t.value), transform: [{ scale: 1 + 0.9 * t.value }] }))
  return (
    <Animated.View
      pointerEvents="none"
      style={[
        {
          borderColor: c.accent,
          borderRadius: size / 2,
          borderWidth: 1.5,
          height: size,
          position: 'absolute',
          width: size,
        },
        style,
      ]}
    />
  )
}

/** Pill segmented control with a sliding thumb. */
export function Segment({
  onChange,
  options,
  style,
  value,
}: {
  onChange: (i: number) => void
  options: readonly string[]
  style?: ViewStyle
  value: number
}) {
  const c = useCue()
  const [w, setW] = useState(0)
  const x = useSharedValue(0)
  const cell = w / options.length
  useEffect(() => {
    x.set(withSpring(value * cell, SPRING))
  }, [value, cell, x])
  const thumb = useAnimatedStyle(() => ({ transform: [{ translateX: x.value }] }))
  return (
    <Glass radius={999} style={{ padding: 4, ...style }}>
      <View onLayout={(e) => setW(e.nativeEvent.layout.width)} style={{ flexDirection: 'row' }}>
        <Animated.View
          style={[
            { backgroundColor: c.accent, borderRadius: 999, bottom: 0, position: 'absolute', top: 0, width: cell },
            thumb,
          ]}
        />
        {options.map((label, i) => (
          <Pressable
            accessibilityRole="button"
            key={label}
            onPress={() => onChange(i)}
            style={{ alignItems: 'center', flex: 1, paddingVertical: 11 }}
          >
            <Txt style={{ color: value === i ? c.onAccent : c.muted, fontSize: 15, fontWeight: '600' }}>{label}</Txt>
          </Pressable>
        ))}
      </View>
    </Glass>
  )
}
