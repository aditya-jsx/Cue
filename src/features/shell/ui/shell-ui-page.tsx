import { ScrollView, View } from 'react-native'
import type { PropsWithChildren } from 'react'
import { cn } from 'heroui-native/utils'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

type ShellUiPageProps = PropsWithChildren<{
  centered?: boolean
  contentClassName?: string
  contentContainerClassName?: string
}>

export function ShellUiPage({ centered, contentClassName, contentContainerClassName, children }: ShellUiPageProps) {
  const insets = useSafeAreaInsets()
  return (
    <ScrollView
      className="flex-1 bg-white dark:bg-black"
      // The floating CueTabBar overlays the screen rather than taking layout space (see cue-tab-bar.tsx), so
      // content needs this much clearance to stay reachable/scrollable above it — same value used elsewhere.
      contentContainerStyle={{ flexGrow: 1, paddingBottom: insets.bottom + 130 }}
      contentContainerClassName={cn(
        'gap-6 px-4 py-2',
        {
          'flex-grow justify-center ': centered,
        },
        contentContainerClassName,
      )}
      contentInsetAdjustmentBehavior="automatic"
    >
      <View className={cn('gap-6', contentClassName)}>{children}</View>
    </ScrollView>
  )
}
