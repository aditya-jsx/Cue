import Ionicons from '@expo/vector-icons/Ionicons'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useState } from 'react'
import { useWindowDimensions, View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCue } from '@/features/cue/cue-theme'
import { CueButton, CuePage, Glass, Txt } from '@/features/cue/ui/cue-ui'
import { formatError } from '@/features/wallet/util/format-error'

const enter = (i: number) => FadeInDown.delay(i * 70).duration(600)

export function CueConnect() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const { height } = useWindowDimensions()
  const { connect } = useMobileWallet()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function onConnect() {
    setBusy(true)
    setError(null)
    try {
      await connect()
    } catch (e) {
      setError(formatError(e))
    } finally {
      setBusy(false)
    }
  }

  return (
    <CuePage>
      <View style={{ paddingHorizontal: 24, paddingTop: Math.max(0, height * 0.2 - insets.top - 8) }}>
        <Animated.View entering={enter(0)}>
          <Glass
            radius={24}
            style={{ alignItems: 'center', height: 76, justifyContent: 'center', marginBottom: 34, width: 76 }}
          >
            <Ionicons color={c.text} name="mic-outline" size={34} />
          </Glass>
        </Animated.View>
        <Animated.View entering={enter(1)}>
          <Txt v="hero">Say it.{'\n'}Cue does it.</Txt>
        </Animated.View>
        <Animated.View entering={enter(2)}>
          <Txt style={{ marginTop: 10 }} v="sub">
            Send tokens, buy on a price, or guard your portfolio with your voice.
          </Txt>
        </Animated.View>
      </View>
      <View style={{ flex: 1 }} />
      <Animated.View entering={enter(3)} style={{ gap: 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        <CueButton label="Connect wallet" loading={busy} loadingLabel="Connecting" onPress={() => void onConnect()} />
        <Txt style={{ marginHorizontal: 12, textAlign: 'center' }} v="k">
          {error ?? 'Signs with your Seeker. Cue never sees your keys.'}
        </Txt>
      </Animated.View>
    </CuePage>
  )
}
