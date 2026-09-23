import { PermissionsAndroid, Platform } from 'react-native'

import CueNative from '../../../../modules/cue-native'

export async function startPriceEngine() {
  if (Platform.OS !== 'android') return
  if (Platform.Version >= 33) await PermissionsAndroid.request('android.permission.POST_NOTIFICATIONS')
  CueNative.startHeartbeatService()
}
