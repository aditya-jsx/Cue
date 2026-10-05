import * as Speech from 'expo-speech'
import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'

const storage = createMMKV({ id: APP_STORAGE_ID })
const KEY = 'cue:spoken-replies'

/** Whether Cue answers out loud. On by default; Settings can turn it off. */
export const $spoken = atom<boolean>(storage.getBoolean(KEY) ?? true)

export function setSpoken(on: boolean) {
  storage.set(KEY, on)
  $spoken.set(on)
  if (!on) void Speech.stop()
}

/** Says `text`, cutting off anything still being said. */
export function speak(text: string) {
  if (!text || !$spoken.get()) return
  void Speech.stop()
  Speech.speak(text, { language: 'en-US' })
}

/** Silences Cue, e.g. before the microphone opens so it never records its own voice. */
export const stopSpeaking = () => void Speech.stop()
