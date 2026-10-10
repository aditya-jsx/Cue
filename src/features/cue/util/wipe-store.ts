import { createMMKV } from 'react-native-mmkv'

/**
 * Empties a store and overwrites the bytes it held. MMKV's clearAll() and remove() only mark data as gone, so old values
 * would still sit in the file until something wrote over them. Writing a filler value after the clear reuses that space
 * from the start, which overwrites the old bytes; the filler is then cleared as well.
 */
export function wipeStore(id: string) {
  const store = createMMKV({ id })
  store.clearAll()
  store.set('wipe', 'x'.repeat(64 * 1024))
  store.clearAll()
}
