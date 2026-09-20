import Ionicons from '@expo/vector-icons/Ionicons'
import * as Linking from 'expo-linking'
import { Alert } from 'heroui-native'
import { Pressable, Text } from 'react-native'

import type { ToolsActionStatus } from '@/features/tools/ui/tools-ui-action-card'

export function ToolsUiStatusAlert({ description, explorerUrl, status, title }: ToolsActionStatus) {
  return (
    <Alert status={status}>
      <Alert.Indicator />
      <Alert.Content>
        <Alert.Title>{title}</Alert.Title>
        <Alert.Description>{description}</Alert.Description>
        {explorerUrl ? (
          <Pressable
            accessibilityHint="Opens transaction in Solana Explorer"
            accessibilityLabel="View on Solana Explorer"
            accessibilityRole="link"
            className="mt-2 flex-row items-center gap-1.5"
            onPress={() => void Linking.openURL(explorerUrl)}
          >
            <Text className="text-sm font-semibold text-blue-600 underline dark:text-blue-400">
              View on Solana Explorer
            </Text>
            <Ionicons color="#3b82f6" name="open-outline" size={14} />
          </Pressable>
        ) : null}
      </Alert.Content>
    </Alert>
  )
}
