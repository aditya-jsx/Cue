import { AppRegistry } from 'react-native'

import CueNative from '../../modules/cue-native'

const SOL_USD_FEED = 'ef0d8b6fda2ceba41da15d4095d1da392a0d2f8ed0c6c7bc0f4cfac8c280b56d'
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// Spike: never resolves, so the headless task (and the JS timers it unpauses) lives as long as the service.
AppRegistry.registerHeadlessTask('CueHeartbeat', () => async () => {
  for (let i = 0; ; i++) {
    let net = ''
    if (i % 6 === 0) {
      try {
        const res = await fetch(`https://hermes.pyth.network/api/latest_price_feeds?ids[]=${SOL_USD_FEED}`)
        net = ` net=${res.status}`
      } catch (e) {
        net = ` net=ERR(${String(e)})`
      }
    }
    const msg = `beat ${i} ${new Date().toISOString()}${net}`
    console.log('[CueSpike]', msg)
    CueNative.heartbeat(msg)
    await sleep(10_000)
  }
})
