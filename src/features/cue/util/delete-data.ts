import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { $cue } from '@/features/cue/data-access/cue-store'
import { $onboarded } from '@/features/cue/data-access/onboarding'
import { clearSessionKey } from '@/features/cue/data-access/session-key'
import { $spoken, $voice } from '@/features/cue/util/speech'
import { wipeStore } from '@/features/cue/util/wipe-store'
import { $delegatedLamports, $triggers } from '@/features/price-triggers/data-access/trigger-store'
import CueNative from '../../../../modules/cue-native'

/**
 * Removes everything Cue keeps on this phone: contacts, activity, rules, preferences, the install id and the session
 * key. It does not touch the wallet or anything on-chain, so the caller must make sure no spending permission is
 * still granted (an orphaned permission could never be revoked from here).
 */
export async function deleteAllCueData(): Promise<void> {
  CueNative.stopWakeWordService()
  CueNative.stopHeartbeatService() // also stops it coming back after a reboot
  await clearSessionKey()
  wipeStore(APP_STORAGE_ID)
  // The stores loaded their values at startup, so reset them too or the old data would reappear until a restart.
  $cue.set({ contacts: [], log: [], wake: true })
  $triggers.set([])
  $delegatedLamports.set(null)
  $spoken.set(true)
  $voice.set('female')
  $onboarded.set(false)
}
