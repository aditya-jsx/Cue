import Ionicons from '@expo/vector-icons/Ionicons'
import { address, isAddress, type Lamports } from '@solana/kit'
import { useQuery } from '@tanstack/react-query'
import { type Account, getExplorerUrl, type useMobileWallet } from '@wallet-ui/react-native-kit'
import * as Linking from 'expo-linking'
import { Button } from 'heroui-native/button'
import { Card } from 'heroui-native/card'
import { Chip } from 'heroui-native/chip'
import { Input } from 'heroui-native/input'
import { useState } from 'react'
import { Pressable, Text, View } from 'react-native'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { useTheme } from '@/features/shell/data-access/use-theme'
import { useWalletSendSol } from '@/features/wallet/data-access/use-wallet-send-sol'
import { WalletUiStatusAlert } from '@/features/wallet/ui/wallet-ui-status-alert'
import { formatError } from '@/features/wallet/util/format-error'

const QUICK_AMOUNTS = ['0.001', '0.005', '0.01', '0.05'] as const
const LAMPORTS_PER_SOL = 1_000_000_000n

function solToLamports(sol: number): bigint {
  return BigInt(Math.round(sol * 1_000_000_000))
}

function formatLamports(lamports: Lamports | bigint) {
  const bigLamports = BigInt(lamports)
  const fractional = bigLamports % LAMPORTS_PER_SOL
  const whole = bigLamports / LAMPORTS_PER_SOL

  if (fractional === 0n) {
    return `${whole.toLocaleString()} SOL`
  }

  const fractionalDisplay = fractional.toString().padStart(9, '0').replace(/0+$/, '')
  return `${whole.toLocaleString()}.${fractionalDisplay} SOL`
}

export function WalletFeatureSendSol({
  account,
  getTransactionSigner,
}: {
  account: Account
  getTransactionSigner: ReturnType<typeof useMobileWallet>['getTransactionSigner']
}) {
  const { client, cluster } = useAppCluster()
  const { tintColor } = useTheme()
  const [destination, setDestination] = useState('')
  const [amount, setAmount] = useState('0.001')
  const [confirmedSignature, setConfirmedSignature] = useState<string | null>(null)

  const sendSol = useWalletSendSol({
    account,
    client,
    getTransactionSigner,
  })

  const trimmedDestination = destination.trim()
  const hasDestination = trimmedDestination.length > 0
  const isValidAddress = hasDestination && isAddress(trimmedDestination)

  const parsedAmount = parseFloat(amount.trim())
  const isValidAmount = !isNaN(parsedAmount) && parsedAmount > 0

  const canSubmit = isValidAddress && isValidAmount && !sendSol.isPending

  const recipientQuery = useQuery({
    enabled: isValidAddress,
    queryFn: async () => {
      try {
        const res = await client.rpc.getBalance(address(trimmedDestination), { commitment: 'confirmed' }).send()
        return formatLamports(res.value)
      } catch {
        return '0 SOL (Unfunded)'
      }
    },
    queryKey: ['recipient-balance', cluster.id, trimmedDestination],
  })

  async function handleSend() {
    if (!canSubmit) {
      return
    }

    try {
      setConfirmedSignature(null)
      const signature = await sendSol.mutateAsync({
        amountLamports: solToLamports(parsedAmount),
        destination: trimmedDestination,
      })
      setConfirmedSignature(signature)
      void recipientQuery.refetch()
    } catch {
      // Error is caught and surfaced through sendSol.error below
    }
  }

  const explorerUrl = confirmedSignature
    ? getExplorerUrl({
        network: {
          id: cluster.id,
          url: cluster.url,
        },
        path: `/tx/${confirmedSignature}`,
        provider: 'solana',
      })
    : null

  const solscanUrl = confirmedSignature ? `https://solscan.io/tx/${confirmedSignature}?cluster=devnet` : null

  const handleOpenUrl = async (url: string | null) => {
    if (!url) return
    try {
      await Linking.openURL(url)
    } catch (err) {
      console.warn('Failed to open URL:', err)
    }
  }

  return (
    <Card className="w-full gap-3 p-4">
      <Card.Body className="gap-4">
        <View className="gap-1">
          <View className="flex-row items-center gap-2">
            <Ionicons color={tintColor} name="paper-plane-outline" size={22} />
            <Card.Title className="flex-1 text-xl font-bold">Send SOL</Card.Title>
            <Chip color="default" size="sm" variant="soft">
              {cluster.label}
            </Chip>
          </View>
          <Card.Description className="leading-relaxed">
            Transfer SOL to any Solana address on {cluster.label}.
          </Card.Description>
        </View>

        <View className="gap-1.5">
          <View className="flex-row items-center justify-between">
            <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Recipient Address</Text>
            {isValidAddress && recipientQuery.data ? (
              <Text className="text-xs text-neutral-500 dark:text-neutral-400">
                {recipientQuery.isFetching ? 'Checking...' : `Devnet Balance: ${recipientQuery.data}`}
              </Text>
            ) : null}
          </View>
          <Input
            autoCapitalize="none"
            autoCorrect={false}
            editable={!sendSol.isPending}
            onChangeText={(val) => {
              setDestination(val)
              setConfirmedSignature(null)
            }}
            placeholder="Solana address (base58)"
            value={destination}
          />
          {hasDestination && !isValidAddress ? (
            <Text className="text-xs text-red-500">Please enter a valid 32-byte base58 address</Text>
          ) : null}
        </View>

        <View className="gap-1.5">
          <Text className="text-sm font-medium text-neutral-700 dark:text-neutral-300">Amount (SOL)</Text>
          <Input
            editable={!sendSol.isPending}
            keyboardType="decimal-pad"
            onChangeText={(val) => {
              setAmount(val)
              setConfirmedSignature(null)
            }}
            placeholder="0.001"
            value={amount}
          />

          <View className="flex-row flex-wrap gap-2 pt-1">
            {QUICK_AMOUNTS.map((quickAmount) => (
              <Pressable
                accessibilityLabel={`Set amount to ${quickAmount} SOL`}
                accessibilityRole="button"
                disabled={sendSol.isPending}
                key={quickAmount}
                onPress={() => {
                  setAmount(quickAmount)
                  setConfirmedSignature(null)
                }}
              >
                <Chip
                  color={amount === quickAmount ? 'accent' : 'default'}
                  size="sm"
                  variant={amount === quickAmount ? 'primary' : 'soft'}
                >
                  {quickAmount} SOL
                </Chip>
              </Pressable>
            ))}
          </View>
        </View>

        {sendSol.isError ? (
          <WalletUiStatusAlert description={formatError(sendSol.error)} status="danger" title="Transaction failed" />
        ) : null}

        {confirmedSignature && explorerUrl ? (
          <View className="gap-3 rounded-xl border border-emerald-500/20 bg-emerald-500/10 p-3.5">
            <View className="flex-row items-center gap-2">
              <Ionicons color="#10b981" name="checkmark-circle" size={20} />
              <Text className="font-semibold text-emerald-800 dark:text-emerald-200">Transaction Confirmed!</Text>
            </View>

            {recipientQuery.data ? (
              <Text className="text-xs font-medium text-emerald-700 dark:text-emerald-300">
                Recipient Devnet Balance: {recipientQuery.data}
              </Text>
            ) : null}

            <View className="gap-1">
              <Text className="text-[11px] text-neutral-600 dark:text-neutral-400">Signature:</Text>
              <Text className="font-mono text-xs text-neutral-800 dark:text-neutral-200" numberOfLines={2} selectable>
                {confirmedSignature}
              </Text>
            </View>

            <View className="gap-2 pt-1">
              <Pressable
                accessibilityHint="Opens transaction in Solana Explorer"
                accessibilityLabel="Open in Solana Explorer"
                accessibilityRole="link"
                className="flex-row items-center justify-between rounded-lg bg-white/80 p-2.5 shadow-sm active:opacity-70 dark:bg-neutral-800/80"
                onPress={() => void handleOpenUrl(explorerUrl)}
              >
                <View className="flex-1 pr-2">
                  <Text className="text-xs font-semibold text-blue-600 dark:text-blue-400">
                    Open in Solana Explorer (Devnet)
                  </Text>
                  <Text className="text-[10px] text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
                    {explorerUrl}
                  </Text>
                </View>
                <Ionicons color={tintColor} name="open-outline" size={16} />
              </Pressable>

              {solscanUrl ? (
                <Pressable
                  accessibilityHint="Opens transaction in Solscan"
                  accessibilityLabel="Open in Solscan"
                  accessibilityRole="link"
                  className="flex-row items-center justify-between rounded-lg bg-white/80 p-2.5 shadow-sm active:opacity-70 dark:bg-neutral-800/80"
                  onPress={() => void handleOpenUrl(solscanUrl)}
                >
                  <View className="flex-1 pr-2">
                    <Text className="text-xs font-semibold text-purple-600 dark:text-purple-400">
                      Open in Solscan (Devnet)
                    </Text>
                    <Text className="text-[10px] text-neutral-500 dark:text-neutral-400" numberOfLines={1}>
                      {solscanUrl}
                    </Text>
                  </View>
                  <Ionicons color={tintColor} name="open-outline" size={16} />
                </Pressable>
              ) : null}
            </View>
          </View>
        ) : null}

        <Button isDisabled={!canSubmit} variant="primary" onPress={() => void handleSend()}>
          <View className="flex-row items-center justify-center gap-2" pointerEvents="none">
            <Ionicons
              color={canSubmit ? '#ffffff' : '#9ca3af'}
              name={sendSol.isPending ? 'sync' : 'paper-plane'}
              size={18}
            />
            <Button.Label>{sendSol.isPending ? 'Confirming on Devnet...' : `Send ${amount || '0'} SOL`}</Button.Label>
          </View>
        </Button>
      </Card.Body>
    </Card>
  )
}
