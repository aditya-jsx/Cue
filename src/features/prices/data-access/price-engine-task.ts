import { createMMKV } from 'react-native-mmkv'
import { AppRegistry } from 'react-native'

import { activeCluster } from '@/features/cluster/data-access/active-client'
import { APP_STORAGE_ID } from '@/features/cluster/data-access/create-cluster-props'
import { createSolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { evaluateTriggers } from '@/features/price-triggers/util/evaluate-triggers'
import { fetchPrices } from '@/features/prices/util/fetch-prices'
import { maxPriceAgeMs } from '@/features/prices/util/price-freshness'
import { type PollStats, recordPoll } from '@/features/prices/util/poll-stats'
import CueNative from '../../../../modules/cue-native'

const POLL_INTERVAL_MS = 30_000
export const POLL_STATS_KEY = 'cue:poll-stats'
const statsStorage = createMMKV({ id: APP_STORAGE_ID })
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

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
      const cluster = activeCluster()
      const client = createSolanaClient(cluster)
      await fetchPrices(client)
      await evaluateTriggers(client, maxPriceAgeMs(cluster.id), cluster.id)
    } catch (error) {
      console.warn('[CuePriceEngine] Poll failed:', error)
    }
    // Kept on the phone (the log buffer only holds minutes), so a screen-off soak can be read hours later.
    try {
      const prev = statsStorage.getString(POLL_STATS_KEY)
      statsStorage.set(
        POLL_STATS_KEY,
        JSON.stringify(recordPoll(prev ? (JSON.parse(prev) as PollStats) : null, Date.now())),
      )
    } catch {
      // statistics only; never let them stop the engine
    }
    CueNative.heartbeat(`poll ${i} ${new Date().toISOString()}`)
    await sleep(POLL_INTERVAL_MS)
  }
})
