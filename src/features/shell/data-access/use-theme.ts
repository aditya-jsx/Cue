import * as SystemUI from 'expo-system-ui'
import { useEffect } from 'react'
import { Uniwind, useUniwind } from 'uniwind'

export type Theme = 'dark' | 'light' | 'system'
export type ThemeOption = { label: string; name: Theme }

const TINT_DARK = '#F5F5F6'
const TINT_LIGHT = '#0A0B0C'
const BG_DARK = '#050505'
const BG_LIGHT = '#F1F2F3'
const FG_DARK = '#FAFAFA'
const FG_LIGHT = '#111827'
const MUTED_DARK = '#A3A3A3'
const MUTED_LIGHT = '#6B7280'

const themes: ThemeOption[] = [
  { label: 'Dark', name: 'dark' },
  { label: 'Light', name: 'light' },
  { label: 'System', name: 'system' },
]

export interface UseThemeResult {
  activeTheme: Theme
  backgroundColor: string
  foregroundColor: string
  iconColor: { default: string; selected: string }
  indicatorColor: string
  isDark: boolean
  isLight: boolean
  mutedColor: string
  navigationHeaderOptions: {
    headerShadowVisible: false
    headerStyle: { backgroundColor: string }
    headerTitleAlign: 'left'
    headerTintColor: string
    headerTitleStyle: { color: string }
  }
  theme: 'dark' | 'light'
  themes: ThemeOption[]
  tintColor: string
}

export function setTheme(theme: Theme) {
  Uniwind.setTheme(theme)
}

export function useTheme(): UseThemeResult {
  const { hasAdaptiveThemes, theme } = useUniwind()
  const isDark = theme === 'dark'
  const isLight = theme === 'light'
  const backgroundColor = isLight ? BG_LIGHT : BG_DARK
  const foregroundColor = isLight ? FG_LIGHT : FG_DARK
  const mutedColor = isLight ? MUTED_LIGHT : MUTED_DARK

  useEffect(() => {
    SystemUI.setBackgroundColorAsync(backgroundColor).catch(() => undefined)
  }, [backgroundColor])

  return {
    activeTheme: hasAdaptiveThemes ? 'system' : theme,
    backgroundColor,
    foregroundColor,
    iconColor: { default: mutedColor, selected: isLight ? TINT_LIGHT : TINT_DARK },
    indicatorColor: isLight ? '#E5E6E8' : '#1A1B1D',
    isDark,
    isLight,
    mutedColor,
    navigationHeaderOptions: {
      headerShadowVisible: false,
      headerStyle: { backgroundColor },
      headerTitleAlign: 'left',
      headerTintColor: isLight ? TINT_LIGHT : TINT_DARK,
      headerTitleStyle: { color: foregroundColor },
    },
    theme,
    themes,
    tintColor: isLight ? TINT_LIGHT : TINT_DARK,
  }
}
