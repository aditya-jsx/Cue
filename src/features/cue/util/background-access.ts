import { Alert, Platform } from 'react-native'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import CueNative from '../../../../modules/cue-native'

const storage = createMMKV({ id: APP_STORAGE_ID })
const ASKED_KEY = 'cue:asked-background-access'

/** True when Android won't pause Cue to save battery, so rules keep running with the screen off. */
export const isBackgroundAllowed = (): boolean =>
  Platform.OS !== 'android' || CueNative.isIgnoringBatteryOptimizations()

/** Asks Android to exempt Cue from battery optimisation, after explaining why. */
export function askBackgroundAccess() {
  if (isBackgroundAllowed()) return
  Alert.alert(
    'Keep Cue running',
    'With the screen off, Android can pause apps to save battery, which would stop your rules from firing. Allow Cue to keep running in the background?',
    [
      { style: 'cancel', text: 'Not now' },
      { onPress: () => CueNative.requestIgnoreBatteryOptimizations(), text: 'Allow' },
    ],
  )
}

/** Asks once, the first time a rule goes live (when running in the background starts to matter). */
export function askBackgroundAccessOnce() {
  if (storage.getBoolean(ASKED_KEY)) return
  storage.set(ASKED_KEY, true)
  askBackgroundAccess()
}
