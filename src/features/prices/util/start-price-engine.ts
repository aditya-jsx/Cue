import { Platform } from 'react-native'

import CueNative from '../../../../modules/cue-native'

// Notification permission is asked during onboarding, where the screen explains why, not here.
export async function startPriceEngine() {
  if (Platform.OS !== 'android') return
  CueNative.startHeartbeatService()
}
