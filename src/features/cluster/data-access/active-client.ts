import { createMMKV } from 'react-native-mmkv'

import { APP_CLUSTER_STORAGE_KEY, APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { resolveActiveSolanaCluster } from '@/features/cluster/data-access/cluster-store'
import { createMmkvCache } from '@/features/cluster/data-access/mmkv-cache'
import { createSolanaClient } from '@/features/cluster/data-access/create-solana-client'

// Outside the React tree (headless task, background voice commands) there is no useAppCluster(), so read the
// persisted active cluster from the same MMKV-backed cache the ClusterProvider uses. Re-read on each call, in case
// the user switched clusters in Settings.
const clusterCache = createMmkvCache<unknown>({
  storage: createMMKV({ id: APP_STORAGE_ID }),
  storageKey: APP_CLUSTER_STORAGE_KEY,
})

export function activeCluster() {
  return resolveActiveSolanaCluster(clusterCache)
}

export function activeSolanaClient() {
  return createSolanaClient(activeCluster())
}
