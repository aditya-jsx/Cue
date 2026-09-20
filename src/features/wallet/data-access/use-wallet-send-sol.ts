import type { Account } from '@wallet-ui/react-native-kit'
import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import type { Address, Lamports, TransactionSendingSigner } from '@solana/kit'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import { executeWalletSendSol } from '@/features/wallet/util/execute-wallet-send-sol'

export interface UseWalletSendSolProps {
  account: Account
  client: SolanaClient
  getTransactionSigner: (address: Address, minContextSlot: bigint) => TransactionSendingSigner
}

export interface SendSolMutationVariables {
  amountLamports: Lamports | bigint
  destination: string
}

export function useWalletSendSol({ account, client, getTransactionSigner }: UseWalletSendSolProps) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: ({ amountLamports, destination }: SendSolMutationVariables) =>
      executeWalletSendSol({
        account,
        amountLamports,
        client,
        destination,
        getTransactionSigner,
      }),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['get-balance'] }),
        queryClient.invalidateQueries({ queryKey: ['get-transaction-signatures'] }),
      ])
    },
  })
}
