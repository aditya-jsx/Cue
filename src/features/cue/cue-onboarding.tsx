import Ionicons from '@expo/vector-icons/Ionicons'
import { useState } from 'react'
import { View } from 'react-native'
import Animated, { FadeInDown } from 'react-native-reanimated'
import { useSafeAreaInsets } from 'react-native-safe-area-context'

import { useCue } from '@/features/cue/cue-theme'
import { finishOnboarding } from '@/features/cue/data-access/onboarding'
import { CueButton, CuePage, Glass, type IconName, Press, Txt } from '@/features/cue/ui/cue-ui'
import { requestCuePermissions } from '@/features/cue/util/permissions'

interface Point {
  detail: string
  icon: IconName
  title: string
}

const STEPS: readonly { intro: string; points: readonly Point[]; title: string }[] = [
  {
    intro:
      'Your voice-first wallet agent. Tell Cue what you want and it shows exactly what it understood before anything moves.',
    points: [
      {
        detail: 'Say who and how much, then sign once in your wallet.',
        icon: 'arrow-up-circle-outline',
        title: 'Send',
      },
      {
        detail: 'Set a rule once. Cue buys for you when the price is hit, even with the app closed.',
        icon: 'trending-down-outline',
        title: 'Buy on a price',
      },
      {
        detail: 'Get an alert, or pause your rules, if your portfolio drops.',
        icon: 'shield-checkmark-outline',
        title: 'Guard your portfolio',
      },
    ],
    title: 'Meet Cue',
  },
  {
    intro: 'Cue asks for two things. You can change both any time in Android Settings.',
    points: [
      { detail: 'So Cue can hear you, including "Hey Cue".', icon: 'mic-outline', title: 'Microphone' },
      {
        detail: 'So Cue can tell you when a rule fires or your guard triggers.',
        icon: 'notifications-outline',
        title: 'Notifications',
      },
    ],
    title: 'Two quick permissions',
  },
  {
    intro: 'Cue works inside limits you set, and you can see and undo all of it.',
    points: [
      {
        detail:
          'You approve each permission once. Solana enforces the cap on-chain, and you can revoke it in Settings.',
        icon: 'lock-closed-outline',
        title: 'Your limits',
      },
      { detail: 'Cue never sees them. Every send is signed in your wallet.', icon: 'key-outline', title: 'Your keys' },
      {
        detail:
          "A short recording of each command goes to Cue's server and on to Google's Gemini to work out what you mean. Cue doesn't keep it. Prefer not to? Every action also works from the Do it yourself buttons on Home.",
        icon: 'ear-outline',
        title: 'Your voice',
      },
    ],
    title: 'You stay in control',
  },
]

export function CueOnboarding() {
  const c = useCue()
  const insets = useSafeAreaInsets()
  const [step, setStep] = useState(0)
  const [busy, setBusy] = useState(false)
  const { intro, points, title } = STEPS[step]
  const last = step === STEPS.length - 1

  async function allowAndContinue() {
    setBusy(true)
    try {
      await requestCuePermissions()
    } finally {
      setBusy(false)
      setStep(step + 1)
    }
  }

  return (
    <CuePage>
      <View
        style={{ alignItems: 'center', flexDirection: 'row', justifyContent: 'space-between', paddingHorizontal: 24 }}
      >
        <View style={{ flexDirection: 'row', gap: 6 }}>
          {STEPS.map((_, i) => (
            <View
              key={i}
              style={{
                backgroundColor: i === step ? c.accent : c.sep,
                borderRadius: 3,
                height: 6,
                width: i === step ? 22 : 6,
              }}
            />
          ))}
        </View>
        {last ? null : (
          <Press label="Skip" onPress={finishOnboarding}>
            <Txt style={{ paddingVertical: 6 }} v="sub">
              Skip
            </Txt>
          </Press>
        )}
      </View>

      <Animated.View
        entering={FadeInDown.duration(500)}
        key={step}
        style={{ flex: 1, paddingHorizontal: 24, paddingTop: 36 }}
      >
        <Txt v="large">{title}</Txt>
        <Txt style={{ marginBottom: 24, marginTop: 10 }} v="sub">
          {intro}
        </Txt>
        <Glass radius={26} style={{ gap: 18, paddingHorizontal: 18, paddingVertical: 20 }}>
          {points.map((p) => (
            <View key={p.title} style={{ flexDirection: 'row', gap: 14 }}>
              <Ionicons color={c.text} name={p.icon} size={24} style={{ marginTop: 1 }} />
              <View style={{ flex: 1 }}>
                <Txt style={{ fontSize: 16, fontWeight: '600' }}>{p.title}</Txt>
                <Txt style={{ marginTop: 3 }} v="k">
                  {p.detail}
                </Txt>
              </View>
            </View>
          ))}
        </Glass>
      </Animated.View>

      <View style={{ gap: 12, paddingBottom: insets.bottom + 24, paddingHorizontal: 20 }}>
        {step === 1 ? (
          <>
            <CueButton
              label="Allow and continue"
              loading={busy}
              loadingLabel="Asking"
              onPress={() => void allowAndContinue()}
            />
            <CueButton label="Not now" onPress={() => setStep(step + 1)} variant="glass" />
          </>
        ) : (
          <CueButton
            label={last ? 'Get started' : 'Continue'}
            onPress={last ? finishOnboarding : () => setStep(step + 1)}
          />
        )}
      </View>
    </CuePage>
  )
}
