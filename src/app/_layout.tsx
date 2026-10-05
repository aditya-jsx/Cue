import '../global.css'

import { Tabs } from 'expo-router/js-tabs'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useEffect } from 'react'
import { View } from 'react-native'
import { CueConnect } from '@/features/cue/cue-connect'
import { CueFlow } from '@/features/cue/cue-flow'
import { CueTabBar } from '@/features/cue/cue-tab-bar'
import { flow } from '@/features/cue/data-access/cue-store'
import { startWakeWord } from '@/features/cue/util/start-wake-word'
import { AppProviders } from '@/features/core/data-access/app-providers'
import { useTheme } from '@/features/shell/data-access/use-theme'
import { startPriceEngine } from '@/features/prices/util/start-price-engine'
import CueNative from '../../modules/cue-native'

export default function Layout() {
  useEffect(() => {
    startPriceEngine().catch((e) => console.warn('[CuePriceEngine] start failed', e))
    startWakeWord().catch((e) => console.warn('[CueWakeWord] start failed', e))

    const subscription = CueNative.addListener('onWakeWordDetected', () => {
      CueNative.consumePendingWake() // handled live, so a later start must not listen again
      void flow.startLiveListening('wake')
    })
    // Opened by "Hey Cue" from the background or a locked screen: the event fired before this listener existed.
    if (CueNative.consumePendingWake()) void flow.startLiveListening('wake')
    return () => subscription.remove()
  }, [])

  return (
    <AppProviders>
      <AppTabs />
    </AppProviders>
  )
}

function AppTabs() {
  const { account } = useMobileWallet()
  const { backgroundColor } = useTheme()

  if (!account) {
    return <CueConnect />
  }

  return (
    <View style={{ flex: 1 }}>
      <Tabs
        screenOptions={{ headerShown: false, sceneStyle: { backgroundColor }, tabBarHideOnKeyboard: true }}
        tabBar={(props) => <CueTabBar {...props} />}
      >
        <Tabs.Screen name="index" options={{ title: 'Home' }} />
        <Tabs.Screen name="activity" options={{ title: 'Activity' }} />
        <Tabs.Screen name="settings" options={{ title: 'Settings' }} />
        <Tabs.Screen name="tools" options={{ href: null }} />
      </Tabs>
      <CueFlow />
    </View>
  )
}
