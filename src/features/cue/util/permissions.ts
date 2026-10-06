import { PermissionsAndroid, Platform } from 'react-native'

import { ensureMicPermission } from '@/features/cue/util/mic-permission'

/** Asks for what Cue needs up front, with the onboarding screen having just explained why. Refusals are fine. */
export async function requestCuePermissions(): Promise<void> {
  if (Platform.OS !== 'android') return
  await ensureMicPermission()
  if (Platform.Version >= 33) await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS')
}
