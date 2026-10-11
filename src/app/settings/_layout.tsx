import { Stack } from 'expo-router/stack'

import { useTheme } from '@/features/shell/data-access/use-theme'

export default function SettingsLayout() {
  const { navigationHeaderOptions } = useTheme()

  return (
    <Stack
      screenOptions={{
        gestureEnabled: true,
        ...navigationHeaderOptions,
      }}
    >
      <Stack.Screen name="index" options={{ headerShown: false }} />
    </Stack>
  )
}
