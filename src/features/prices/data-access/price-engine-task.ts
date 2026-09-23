import { createMMKV } from 'react-native-mmkv'
import { AppRegistry } from 'react-native'

import { APP_CLUSTER_STORAGE_KEY, APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { createSolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { resolveActiveSolanaCluster } from '@/features/cluster/data-access/cluster-store'
import { createMmkvCache } from '@/features/cluster/data-access/mmkv-cache'
import { evaluateTriggers } from '@/features/conditional-buy/util/evaluate-triggers'
import { fetchPrices } from '@/features/prices/util/fetch-prices'
import CueNative from '../../../../modules/cue-native'

const POLL_INTERVAL_MS = 30_000
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Headless tasks run outside the React tree (no useAppCluster()), so read the persisted active cluster straight
// from the same MMKV-backed cache the ClusterProvider uses, and re-resolve it each poll in case the user switches
// clusters in Settings while the engine is running.
const clusterCache = createMmkvCache<unknown>({
  storage: createMMKV({ id: APP_STORAGE_ID }),
  storageKey: APP_CLUSTER_STORAGE_KEY,
})

// The foreground service can call startForegroundService again (e.g. app relaunch) while a previous headless task
// is still alive; without this guard each call stacks another concurrent polling loop (seen in the earlier spike).
let running = false

/**
 * Runs for as long as the foreground service is alive (survives backgrounding/screen-off, per the earlier spike),
 * polling Pyth for live prices so Conditional Buy and Portfolio Guard have something to evaluate against even
 * while the app is closed. Never resolves — that's what keeps the headless task (and this loop) running.
 */
AppRegistry.registerHeadlessTask('CueHeartbeat', () => async () => {
  if (running) return
  running = true

  for (let i = 0; ; i++) {
    try {
      const client = createSolanaClient(resolveActiveSolanaCluster(clusterCache))
      await fetchPrices(client)
      await evaluateTriggers(client)
    } catch (error) {
      console.warn('[CuePriceEngine] Poll failed:', error)
    }
    CueNative.heartbeat(`poll ${i} ${new Date().toISOString()}`)
    await sleep(POLL_INTERVAL_MS)
  }
})
