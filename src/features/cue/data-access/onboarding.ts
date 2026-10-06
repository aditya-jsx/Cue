import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'

const storage = createMMKV({ id: APP_STORAGE_ID })
const KEY = 'cue:onboarded'

/** Whether the first-run introduction has been seen (or skipped). It only ever shows once. */
export const $onboarded = atom<boolean>(storage.getBoolean(KEY) ?? false)

/** Dev builds only: lets the introduction be seen again without wiping the app's data. */
export function resetOnboarding() {
  storage.set(KEY, false)
  $onboarded.set(false)
}

export function finishOnboarding() {
  storage.set(KEY, true)
  $onboarded.set(true)
}
