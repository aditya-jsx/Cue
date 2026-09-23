import { Stack } from 'expo-router/stack'

import { useTheme } from '@/features/shell/data-access/use-theme'
import { ShellUiHeaderTitle } from '@/features/shell/ui/shell-ui-page-header'

export default function ToolsLayout() {
  const { foregroundColor, navigationHeaderOptions, tintColor } = useTheme()

  return (
    <Stack
      screenOptions={{
        gestureEnabled: true,
        ...navigationHeaderOptions,
      }}
    >
      <Stack.Screen
        name="index"
        options={{
          headerTitle: () => (
            <ShellUiHeaderTitle
              foregroundColor={foregroundColor}
              icon="construct-outline"
              tintColor={tintColor}
              title="Tools"
            />
          ),
          title: 'Tools',
        }}
      />
      <Stack.Screen
        name="wallet-actions"
        options={{
          headerTitle: () => (
            <ShellUiHeaderTitle
              foregroundColor={foregroundColor}
              icon="wallet-outline"
              tintColor={tintColor}
              title="Wallet actions"
            />
          ),
          title: 'Wallet actions',
        }}
      />
      <Stack.Screen
        name="autonomous-action"
        options={{
          headerTitle: () => (
            <ShellUiHeaderTitle
              foregroundColor={foregroundColor}
              icon="flash-outline"
              tintColor={tintColor}
              title="Autonomous action"
            />
          ),
          title: 'Autonomous action',
        }}
      />
      <Stack.Screen
        name="conditional-buy"
        options={{
          headerTitle: () => (
            <ShellUiHeaderTitle
              foregroundColor={foregroundColor}
              icon="trending-up-outline"
              tintColor={tintColor}
              title="Conditional Buy"
            />
          ),
          title: 'Conditional Buy',
        }}
      />
    </Stack>
  )
}
