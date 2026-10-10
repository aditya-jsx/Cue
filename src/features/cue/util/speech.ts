import * as Speech from 'expo-speech'
import { atom } from 'nanostores'
import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import CueNative from '../../../../modules/cue-native'

const storage = createMMKV({ id: APP_STORAGE_ID })
const KEY = 'cue:spoken-replies'

/** Whether Cue answers out loud. On by default; Settings can turn it off. */
export const $spoken = atom<boolean>(storage.getBoolean(KEY) ?? true)

export function setSpoken(on: boolean) {
  storage.set(KEY, on)
  $spoken.set(on)
  if (!on) void Speech.stop()
}

const VOICE_KEY = 'cue:voice'

/** Cue's two voices: Google's offline US voices, chosen by ear on a moto g62. */
export const VOICES = { female: 'en-us-x-tpc-local', male: 'en-us-x-iol-local' } as const
export type CueVoice = keyof typeof VOICES

export const $voice = atom<CueVoice>(storage.getString(VOICE_KEY) === 'male' ? 'male' : 'female')

/** Picks a voice and plays it, so the choice is heard straight away. */
export function setVoice(voice: CueVoice) {
  storage.set(VOICE_KEY, voice)
  $voice.set(voice)
  say("Hi, I'm Cue. I'll keep an eye on your wallet.")
}

// Cue's own voice can sound like "Hey Cue" to the wake word, so detection pauses while it talks. Only the latest
// utterance ends the pause: stopping one to start the next reports the old one as stopped after the new one began.
let utterance = 0
function say(text: string) {
  void Speech.stop()
  const id = ++utterance
  const done = () => {
    if (id === utterance) CueNative.setSpeaking(false)
  }
  CueNative.setSpeaking(true)
  // If the voice isn't on this phone, Android falls back to its default voice for the language.
  Speech.speak(text, { language: 'en-US', onDone: done, onError: done, onStopped: done, voice: VOICES[$voice.get()] })
}

/** Says `text`, cutting off anything still being said. */
export function speak(text: string) {
  if (!text || !$spoken.get()) return
  say(text)
}

/** Silences Cue, e.g. before the microphone opens so it never records its own voice. */
export const stopSpeaking = () => void Speech.stop()
