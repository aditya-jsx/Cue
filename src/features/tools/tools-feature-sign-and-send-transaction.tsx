import { getExplorerUrl } from '@wallet-ui/react-native-kit'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import {
  useWalletSignAndSendTransaction,
  type UseWalletSignAndSendTransactionProps,
} from '@/features/wallet/data-access/use-wallet-sign-and-send-transaction'
import { ToolsUiActionCard } from '@/features/tools/ui/tools-ui-action-card'

export function ToolsFeatureSignAndSendTransaction(props: UseWalletSignAndSendTransactionProps) {
  const { isPending, mutateAsync } = useWalletSignAndSendTransaction(props)
  const { cluster } = useAppCluster()

  return (
    <ToolsUiActionCard
      actionLabel="Sign and Send Transaction"
      defaultText="Hello Solana!"
      description="Create a memo transaction, submit it through the wallet, and confirm on Devnet."
      isLoading={isPending}
      onSubmit={async (text) => {
        const signature = await mutateAsync(text)
        const explorerUrl = getExplorerUrl({
          network: {
            id: cluster.id,
            url: cluster.url,
          },
          path: `/tx/${signature}`,
          provider: 'solana',
        })

        return {
          description: `Confirmed on ${cluster.label}: ${signature}`,
          explorerUrl,
          status: 'success',
          title: 'Transaction confirmed',
        }
      }}
      title="Sign and Send Transaction"
    />
  )
}
