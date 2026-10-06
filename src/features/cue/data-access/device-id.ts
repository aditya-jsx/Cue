import { createMMKV } from 'react-native-mmkv'

import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'

const storage = createMMKV({ id: APP_STORAGE_ID })
const KEY = 'cue:device-id'

/** A random id for this install, sent with each parse request so the server can rate-limit per device. */
export function getDeviceId(): string {
  let id = storage.getString(KEY)
  if (!id) {
    const bytes = new Uint8Array(16)
    crypto.getRandomValues(bytes)
    id = Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('')
    storage.set(KEY, id)
  }
  return id
}
