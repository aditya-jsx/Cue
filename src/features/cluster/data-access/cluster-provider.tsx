import { useStore } from '@nanostores/react'
import type { SolanaCluster, SolanaClusterId } from '@wallet-ui/react-native-kit'
import type { PropsWithChildren } from 'react'
import { createContext, useContext, useMemo } from 'react'

import type { AppCluster, ClusterStore } from '@/features/cluster/data-access/cluster-store'
import { createSolanaClient, type SolanaClient } from '@/features/cluster/data-access/create-solana-client'

export interface ClusterContextValue {
  client: SolanaClient
  cluster: SolanaCluster
  clusters: AppCluster[]
  setCluster(cluster: SolanaClusterId): void
}

export interface ClusterProviderProps {
  store: ClusterStore
}

const ClusterContext = createContext<ClusterContextValue | undefined>(undefined)

export function ClusterProvider({ children, store }: PropsWithChildren<ClusterProviderProps>) {
  const cluster = useStore(store.$cluster)
  const clusters = useStore(store.$clusters)
  const client = useMemo(() => createSolanaClient(cluster), [cluster])

  const value = useMemo(
    () => ({
      client,
      cluster,
      clusters,
      setCluster: store.setCluster,
    }),
    [client, cluster, clusters, store.setCluster],
  )

  return <ClusterContext.Provider value={value}>{children}</ClusterContext.Provider>
}

export function useAppCluster() {
  const context = useContext(ClusterContext)
  if (!context) {
    throw new Error('useAppCluster must be used within AppClusterProvider')
  }
  return context
}
