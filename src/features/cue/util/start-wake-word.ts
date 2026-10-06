import { PermissionsAndroid, Platform } from 'react-native'

import { resumeWakeWord } from '@/features/cue/data-access/cue-store'

export async function startWakeWord() {
  if (Platform.OS !== 'android') return
  // Microphone permission is asked during onboarding, or when the mic button is tapped; this only uses it if given.
  if (!(await PermissionsAndroid.check('android.permission.RECORD_AUDIO'))) return
  resumeWakeWord()
}
