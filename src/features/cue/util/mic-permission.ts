import { PermissionsAndroid, Platform } from 'react-native'

const MIC = 'android.permission.RECORD_AUDIO'

/** True when Cue may use the microphone. Asks at the moment it is needed, so a refusal at first launch isn't final. */
export async function ensureMicPermission(): Promise<boolean> {
  if (Platform.OS !== 'android') return true
  if (await PermissionsAndroid.check(MIC)) return true
  return (await PermissionsAndroid.request(MIC)) === PermissionsAndroid.RESULTS.GRANTED
}
