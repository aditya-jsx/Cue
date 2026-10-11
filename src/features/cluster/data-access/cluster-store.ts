import { atom, computed } from 'nanostores'
import {
  createSolanaDevnet,
  createSolanaLocalnet,
  createSolanaMainnet,
  createSolanaTestnet,
} from '@wallet-ui/react-native-kit'
import type { SolanaClusterId } from '@wallet-ui/react-native-kit'

import type { SyncCache } from '@/features/cluster/data-access/sync-cache'

export interface AppCluster {
  id: SolanaClusterId
  isEnabled: boolean
  label: string
  url: string
}

export interface ClusterStoreContext {
  cache: SyncCache<unknown>
}

interface ClusterStoreState {
  clusterId: SolanaClusterId
  clusters: AppCluster[]
}

interface StoredCluster {
  id: SolanaClusterId
  url?: string
}

interface StoredClusterState {
  clusterId?: SolanaClusterId
  clusters?: StoredCluster[]
}

const DEFAULT_CLUSTER_ID = 'solana:devnet' as SolanaClusterId

// Cue's own RPC (the parser server forwards to Helius with the key kept server-side), so nobody pastes an RPC key.
// Without the server configured, devnet falls back to the public endpoint and mainnet starts disabled.
const CUE_API = process.env.EXPO_PUBLIC_CUE_API_URL
const cueRpc = (cluster: 'devnet' | 'mainnet') => (CUE_API ? `${CUE_API}/api/rpc?cluster=${cluster}` : '')

export const DEFAULT_CLUSTERS = [
  {
    id: 'solana:devnet' as SolanaClusterId,
    label: 'Devnet',
    url: cueRpc('devnet') || 'https://api.devnet.solana.com',
  },
  {
    id: 'solana:mainnet' as SolanaClusterId,
    label: 'Mainnet',
    url: cueRpc('mainnet'),
  },
] as const satisfies readonly Omit<AppCluster, 'isEnabled'>[]

function createAppCluster(cluster: Omit<AppCluster, 'isEnabled'>): AppCluster {
  const url = cluster.url.trim()

  return {
    ...cluster,
    isEnabled: url.length > 0,
    url,
  }
}

function createDefaultState(): ClusterStoreState {
  return {
    clusterId: DEFAULT_CLUSTER_ID,
    clusters: DEFAULT_CLUSTERS.map(createAppCluster),
  }
}

function createSolanaCluster(cluster: AppCluster) {
  if (!cluster.isEnabled) {
    return null
  }

  switch (cluster.id) {
    case 'solana:devnet':
      return createSolanaDevnet({ label: cluster.label, url: cluster.url })
    case 'solana:localnet':
      return createSolanaLocalnet({ label: cluster.label, url: cluster.url })
    case 'solana:mainnet':
      return createSolanaMainnet({ label: cluster.label, url: cluster.url })
    case 'solana:testnet':
      return createSolanaTestnet({ label: cluster.label, url: cluster.url })
    default:
      return null
  }
}

function findEnabledCluster(clusters: AppCluster[], clusterId: SolanaClusterId | string | undefined) {
  return clusters.find((cluster) => cluster.id === clusterId && cluster.isEnabled)
}

function findFallbackCluster(clusters: AppCluster[], clusterId: SolanaClusterId | string | undefined) {
  return (
    findEnabledCluster(clusters, clusterId) ??
    findEnabledCluster(clusters, DEFAULT_CLUSTER_ID) ??
    clusters.find((cluster) => cluster.isEnabled)
  )
}

function getEnabledSolanaCluster(clusters: AppCluster[], clusterId: SolanaClusterId | string | undefined) {
  const cluster = findFallbackCluster(clusters, clusterId)
  const solanaCluster = cluster ? createSolanaCluster(cluster) : null

  if (!solanaCluster) {
    throw new Error('At least one cluster must have an RPC URL.')
  }

  return solanaCluster
}

function getStoredClusterState(value: unknown): StoredClusterState {
  if (typeof value === 'string') {
    return { clusterId: value as SolanaClusterId }
  }

  if (!value || typeof value !== 'object') {
    return {}
  }

  return value as StoredClusterState
}

function normalizeState(value: unknown) {
  const stored = getStoredClusterState(value)
  // Only the chosen network is remembered: both always go through Cue's server, so a URL saved by an older build
  // (users could once paste their own) is ignored.
  const clusters = DEFAULT_CLUSTERS.map(createAppCluster)
  const fallbackCluster = findFallbackCluster(clusters, stored.clusterId)

  return fallbackCluster ? { clusterId: fallbackCluster.id, clusters } : createDefaultState()
}

function serializeState(state: ClusterStoreState): StoredClusterState {
  return {
    clusterId: state.clusterId,
    clusters: state.clusters.map(({ id, url }) => ({ id, url })),
  }
}

// Resolves the persisted active cluster (id + RPC URL) from raw cache storage, for code that runs
// outside the React tree (e.g. the headless price-engine task) and can't use useAppCluster().
export function resolveActiveSolanaCluster(cache: SyncCache<unknown>) {
  const state = normalizeState(cache.get())
  return getEnabledSolanaCluster(state.clusters, state.clusterId)
}

export function createClusterStore(context: ClusterStoreContext) {
  const { cache } = context
  const initialState = normalizeState(cache.get())
  const $clusterId = atom(initialState.clusterId)
  const $clusters = atom(initialState.clusters)
  const $cluster = computed([$clusters, $clusterId], (clusters, clusterId) =>
    getEnabledSolanaCluster(clusters, clusterId),
  )

  function getState(): ClusterStoreState {
    return {
      clusterId: $clusterId.get(),
      clusters: $clusters.get(),
    }
  }

  function setState(state: ClusterStoreState) {
    if (!state.clusters.some((cluster) => cluster.isEnabled)) {
      throw new Error('At least one cluster must have an RPC URL.')
    }

    cache.set(serializeState(state))
    $clusters.set(state.clusters)
    $clusterId.set(state.clusterId)
  }

  function setCluster(clusterId: SolanaClusterId) {
    const state = getState()

    if (!findEnabledCluster(state.clusters, clusterId)) {
      throw new Error(`Cluster ${clusterId} does not have an RPC URL.`)
    }

    setState({ ...state, clusterId })
  }

  return {
    $cluster,
    $clusterId,
    $clusters,
    setCluster,
  }
}

export type ClusterStore = ReturnType<typeof createClusterStore>
