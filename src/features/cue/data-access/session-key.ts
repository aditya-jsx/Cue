import {
  createKeyPairSignerFromPrivateKeyBytes,
  getBase64Decoder,
  getBase64Encoder,
  type KeyPairSigner,
} from '@solana/kit'
import * as SecureStore from 'expo-secure-store'
import { createMMKV } from 'react-native-mmkv'

import { wipeStore } from '@/features/cue/util/wipe-store'

const SESSION_KEY_STORAGE_KEY = 'session_private_key_b64'

// Legacy plain-MMKV location (pre-Keystore). Read once to migrate an existing key, then never written to again.
const LEGACY_STORE_ID = 'cue-session' // where earlier builds kept the key, unencrypted
const legacyStorage = createMMKV({ id: LEGACY_STORE_ID })

/**
 * Session key at rest, protected by Android Keystore: expo-secure-store encrypts the value with an AES key that
 * Keystore generates and never releases in plaintext, so the private key can't be lifted by reading app storage
 * (backup, root, adb) even though nothing here requires a biometric prompt — autonomous execution has to sign
 * without the user present, so the key stays unlockable by the app itself, not gated per-use like a login secret.
 * Android Keystore has no native Ed25519 support, so this wraps a normal @solana/kit keypair rather than trying to
 * generate the signing key inside Keystore directly.
 */
export async function getSessionKey(): Promise<KeyPairSigner | null> {
  let b64 = await SecureStore.getItemAsync(SESSION_KEY_STORAGE_KEY)

  if (!b64) {
    const legacy = legacyStorage.getString(SESSION_KEY_STORAGE_KEY)
    if (legacy) {
      await SecureStore.setItemAsync(SESSION_KEY_STORAGE_KEY, legacy)
      wipeStore(LEGACY_STORE_ID) // remove() alone leaves the key's bytes in the file
      b64 = legacy
    }
  }
  if (!b64) return null

  try {
    const bytes = getBase64Encoder().encode(b64)
    if (bytes.length !== 32) {
      await SecureStore.deleteItemAsync(SESSION_KEY_STORAGE_KEY)
      return null
    }
    return await createKeyPairSignerFromPrivateKeyBytes(bytes)
  } catch (err) {
    console.error('[CueSessionKey] Failed to load session key from storage:', err)
    return null
  }
}

/**
 * Retrieves existing session keypair or generates a new ed25519 keypair and persists it.
 */
export async function getOrCreateSessionKey(): Promise<KeyPairSigner> {
  const existing = await getSessionKey()
  if (existing) {
    return existing
  }

  const rawBytes = new Uint8Array(32)
  crypto.getRandomValues(rawBytes)

  const b64 = getBase64Decoder().decode(rawBytes)
  await SecureStore.setItemAsync(SESSION_KEY_STORAGE_KEY, b64)

  return await createKeyPairSignerFromPrivateKeyBytes(rawBytes)
}

/**
 * Removes the session key from persistent storage (e.g. on revocation).
 */
export async function clearSessionKey(): Promise<void> {
  await SecureStore.deleteItemAsync(SESSION_KEY_STORAGE_KEY)
  wipeStore(LEGACY_STORE_ID) // also clears bytes an earlier migration's remove() left behind
}
