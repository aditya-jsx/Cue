import { useTheme } from '@/features/shell/data-access/use-theme'

// Black, metallic grey and white only. Both themes share one shape so components never branch on the theme.
const dark = {
  accent: '#F5F5F6',
  bg: '#050505',
  bg2: '#0B0B0C',
  fill: 'rgba(255,255,255,0.1)',
  glass: 'rgba(255,255,255,0.06)',
  glassStrong: 'rgba(22,23,25,0.94)',
  glow: '#8A8E94',
  highlight: 'rgba(255,255,255,0.2)',
  line: 'rgba(255,255,255,0.12)',
  muted: 'rgba(236,238,240,0.55)',
  onAccent: '#0A0B0C',
  scrim: 'rgba(0,0,0,0.6)',
  sep: 'rgba(255,255,255,0.09)',
  text: '#F5F5F6',
}

const light: typeof dark = {
  accent: '#0A0B0C',
  bg: '#F1F2F3',
  bg2: '#F6F6F7',
  fill: 'rgba(10,11,12,0.06)',
  glass: 'rgba(255,255,255,0.7)',
  glassStrong: 'rgba(250,250,251,0.96)',
  glow: '#FFFFFF',
  highlight: '#FFFFFF',
  line: 'rgba(10,11,12,0.08)',
  muted: 'rgba(10,11,12,0.55)',
  onAccent: '#FFFFFF',
  scrim: 'rgba(10,11,12,0.32)',
  sep: 'rgba(10,11,12,0.09)',
  text: '#0A0B0C',
}

export type CuePalette = typeof dark

export function useCue(): CuePalette {
  return useTheme().isDark ? dark : light
}

// Critically damped and clamped: settles smoothly with no wobble on device.
export const SPRING = { damping: 24, overshootClamping: true, stiffness: 260 } as const

// One motion curve for every transition, matching the prototype.
export const IOS_EASING = [0.32, 0.72, 0, 1] as const
