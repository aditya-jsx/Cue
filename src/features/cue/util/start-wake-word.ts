import { PermissionsAndroid, Platform } from 'react-native'

import { resumeWakeWord } from '@/features/cue/data-access/cue-store'

export async function startWakeWord() {
  if (Platform.OS !== 'android') return
  const granted = await PermissionsAndroid.request('android.permission.RECORD_AUDIO')
  if (granted !== PermissionsAndroid.RESULTS.GRANTED) return
  resumeWakeWord()
}
