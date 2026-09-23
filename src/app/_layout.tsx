import '../global.css'

import { Tabs } from 'expo-router/js-tabs'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { useEffect } from 'react'
import { View } from 'react-native'
import { CueConnect } from '@/features/cue/cue-connect'
import { CueFlow } from '@/features/cue/cue-flow'
import { CueTabBar } from '@/features/cue/cue-tab-bar'
import { AppProviders } from '@/features/core/data-access/app-providers'
import { useTheme } from '@/features/shell/data-access/use-theme'
import { startPriceEngine } from '@/features/prices/util/start-price-engine'

export default function Layout() {
  useEffect(() => {
    startPriceEngine().catch((e) => console.warn('[CuePriceEngine] start failed', e))
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
