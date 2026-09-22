import {
  createKeyPairSignerFromPrivateKeyBytes,
  getBase64Decoder,
  getBase64Encoder,
  type KeyPairSigner,
} from '@solana/kit'
import { createMMKV } from 'react-native-mmkv'

const SESSION_STORAGE_ID = 'cue-session'
const SESSION_KEY_STORAGE_KEY = 'session_private_key_b64'

const sessionStorage = createMMKV({ id: SESSION_STORAGE_ID })

/**
 * Retrieves the stored session keypair, or null if none exists.
 */
export async function getSessionKey(): Promise<KeyPairSigner | null> {
  const b64 = sessionStorage.getString(SESSION_KEY_STORAGE_KEY)
  if (!b64) return null

  try {
    const bytes = getBase64Encoder().encode(b64)
    if (bytes.length !== 32) {
      sessionStorage.remove(SESSION_KEY_STORAGE_KEY)
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
  sessionStorage.set(SESSION_KEY_STORAGE_KEY, b64)

  return await createKeyPairSignerFromPrivateKeyBytes(rawBytes)
}

/**
 * Removes the session key from persistent storage (e.g. on revocation).
 */
export function clearSessionKey(): void {
  sessionStorage.remove(SESSION_KEY_STORAGE_KEY)
}
