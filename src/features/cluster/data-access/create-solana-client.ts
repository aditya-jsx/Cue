import { createClient } from '@solana/kit'
import { solanaRpcConnection } from '@solana/kit-plugin-rpc'
import type { SolanaCluster } from '@wallet-ui/react-native-kit'

import { getDeviceId } from '@/features/cue/data-access/device-id'

const CUE_API = process.env.EXPO_PUBLIC_CUE_API_URL

export function createSolanaClient(cluster: SolanaCluster) {
  // Cue's own RPC endpoint wants the app's token and this install's id (its rate limits are per device).
  const viaCue = Boolean(CUE_API) && cluster.url.startsWith(`${CUE_API}/api/rpc`)
  return createClient().use(
    solanaRpcConnection({
      rpcConfig: viaCue
        ? {
            headers: {
              'x-cue-client': process.env.EXPO_PUBLIC_CUE_CLIENT_TOKEN ?? '',
              'x-cue-device': getDeviceId(),
            },
          }
        : undefined,
      rpcSubscriptionsUrl: cluster.urlWs,
      rpcUrl: cluster.url,
    }),
  )
}

export type SolanaClient = ReturnType<typeof createSolanaClient>
