import Ionicons from '@expo/vector-icons/Ionicons'
import { Link } from 'expo-router'
import { Card } from 'heroui-native/card'
import type { ComponentProps } from 'react'
import { Pressable, View } from 'react-native'

import { useTheme } from '@/features/shell/data-access/use-theme'
import { ShellUiPage } from '@/features/shell/ui/shell-ui-page'

type ToolIcon = ComponentProps<typeof Ionicons>['name']
type ToolItem = {
  description: string
  href: `/tools/${string}`
  icon: ToolIcon
  id: string
  summary: string
  title: string
}

const toolItems = [
  {
    description: 'Run the example wallet requests for signing in, signing messages, and sending transactions.',
    href: '/tools/wallet-actions',
    icon: 'wallet-outline',
    id: 'wallet-actions',
    summary: 'Wallet examples for signing in, signing messages, and sending transactions.',
    title: 'Wallet actions',
  },
  {
    description: 'Spend from the approved delegation using the session key alone — no wallet, no user present.',
    href: '/tools/autonomous-action',
    icon: 'flash-outline',
    id: 'autonomous-action',
    summary: 'Proves the session key can act without the user, within the approved cap.',
    title: 'Autonomous action',
  },
  {
    description: 'Set a price trigger; the price engine fires the autonomous action automatically when it hits.',
    href: '/tools/conditional-buy',
    icon: 'trending-up-outline',
    id: 'conditional-buy',
    summary: 'Trigger registration → price engine evaluates → autonomous execution fires.',
    title: 'Conditional Buy',
  },
  {
    description: 'Set a stop price; the price engine exits automatically to protect your position when it hits.',
    href: '/tools/portfolio-guard',
    icon: 'shield-checkmark-outline',
    id: 'portfolio-guard',
    summary: 'Trigger registration → price engine evaluates → autonomous execution fires.',
    title: 'Portfolio Guard',
  },
] as const satisfies readonly ToolItem[]

export function ToolsFeatureEntry() {
  const { tintColor } = useTheme()

  return (
    <ShellUiPage>
      {toolItems.map((item) => (
        <Link asChild href={item.href} key={item.id}>
          <Pressable accessibilityRole="button">
            <Card className="gap-2 p-5">
              <View className="flex-row items-center gap-2">
                <Ionicons color={tintColor} name={item.icon} size={22} />
                <Card.Title className="flex-1 text-xl font-bold">{item.title}</Card.Title>
                <Ionicons color={tintColor} name="chevron-forward" size={18} />
              </View>
              <Card.Description className="leading-relaxed">{item.description}</Card.Description>
            </Card>
          </Pressable>
        </Link>
      ))}
    </ShellUiPage>
  )
}
