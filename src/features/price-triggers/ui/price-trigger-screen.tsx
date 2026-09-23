import { useStore } from '@nanostores/react'
import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Button } from 'heroui-native/button'
import { Card } from 'heroui-native/card'
import { Dialog } from 'heroui-native/dialog'
import { Input } from 'heroui-native/input'
import { useState } from 'react'
import { Clipboard, Pressable, Text, View } from 'react-native'

import { $prices, type Symbol } from '@/features/prices/data-access/price-store'
import {
  $triggers,
  cancelTrigger,
  createTrigger,
  type PriceTrigger,
  type TriggerDirection,
  type TriggerKind,
} from '@/features/price-triggers/data-access/trigger-store'
import { ShellUiPage } from '@/features/shell/ui/shell-ui-page'
import { WalletUiConnectButton } from '@/features/wallet/ui/wallet-ui-connect-button'

const DEFAULT_AMOUNT_LAMPORTS = '10000000' // 0.01 WSOL, inside the 0.05 WSOL approved cap

export interface PriceTriggerScreenProps {
  defaultDirection: TriggerDirection
  describe: (symbol: Symbol, direction: TriggerDirection) => string
  kind: TriggerKind
  title: string
}

/** Shared UI for Conditional Buy and Portfolio Guard — both are the same price-trigger primitive under different framing. */
export function PriceTriggerScreen({ defaultDirection, describe, kind, title }: PriceTriggerScreenProps) {
  const { account, connect } = useMobileWallet()
  const allTriggers = useStore($triggers)
  const triggers = allTriggers.filter((trigger) => trigger.kind === kind)
  const prices = useStore($prices)
  const [symbol, setSymbol] = useState<Symbol>('SOL')
  const [direction, setDirection] = useState<TriggerDirection>(defaultDirection)
  const [targetUsd, setTargetUsd] = useState('')
  const [amountLamports, setAmountLamports] = useState(DEFAULT_AMOUNT_LAMPORTS)
  const [error, setError] = useState<string | null>(null)

  if (!account) {
    return (
      <ShellUiPage>
        <WalletUiConnectButton connect={connect} size="lg">
          Connect Wallet
        </WalletUiConnectButton>
      </ShellUiPage>
    )
  }

  function handleCreate() {
    if (!account) return
    setError(null)
    const target = Number(targetUsd)
    const amount = BigInt(amountLamports || '0')
    if (!Number.isFinite(target) || target <= 0) {
      setError('Enter a valid target price in USD.')
      return
    }
    if (amount <= 0n) {
      setError('Enter a valid amount in lamports.')
      return
    }
    createTrigger({
      amountLamports: amount,
      direction,
      kind,
      ownerAddress: account.address,
      symbol,
      targetUsd: target,
    })
    setTargetUsd('')
  }

  return (
    <ShellUiPage>
      <Card className="gap-4 p-5">
        <Card.Body className="gap-1">
          <Card.Title className="text-xl font-bold">{title}</Card.Title>
          <Card.Description className="leading-relaxed">{describe(symbol, direction)}</Card.Description>
        </Card.Body>

        <View className="flex-row gap-2">
          {(['SOL', 'JUP'] as const).map((s) => (
            <Button key={s} onPress={() => setSymbol(s)} size="sm" variant={symbol === s ? 'primary' : 'outline'}>
              {s}
            </Button>
          ))}
        </View>
        <View className="flex-row gap-2">
          {(['below', 'above'] as const).map((d) => (
            <Button key={d} onPress={() => setDirection(d)} size="sm" variant={direction === d ? 'primary' : 'outline'}>
              Price goes {d}
            </Button>
          ))}
        </View>
        <Text className="text-sm text-neutral-600 dark:text-neutral-300">
          Current {symbol}/USD: {prices[symbol] ? `$${prices[symbol].usd.toFixed(4)}` : 'loading…'}
        </Text>
        <Input
          keyboardType="decimal-pad"
          onChangeText={setTargetUsd}
          placeholder="Target price (USD)"
          value={targetUsd}
        />
        <Input
          keyboardType="number-pad"
          onChangeText={setAmountLamports}
          placeholder="Amount (lamports of WSOL)"
          value={amountLamports}
        />
        {error ? <Text className="text-sm text-red-500">{error}</Text> : null}
        <Button onPress={handleCreate}>Create Trigger</Button>
      </Card>

      {triggers.map((trigger) => (
        <TriggerCard key={trigger.id} trigger={trigger} />
      ))}
    </ShellUiPage>
  )
}

function TriggerCard({ trigger }: { trigger: PriceTrigger }) {
  const [isOpen, setIsOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  return (
    <Dialog isOpen={isOpen} onOpenChange={setIsOpen}>
      <Dialog.Trigger asChild>
        <Pressable accessibilityRole="button">
          <Card className="gap-1 p-4">
            <Card.Title className="text-base font-semibold">
              {trigger.symbol}/USD {trigger.direction} ${trigger.targetUsd}
            </Card.Title>
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">
              Status: {trigger.status}
              {trigger.signature ? ` · ${trigger.signature.slice(0, 12)}…` : ''}
              {trigger.error ? ` · ${trigger.error}` : ''}
            </Text>
            {trigger.status === 'active' ? (
              <View className="mt-1">
                <Button
                  onPress={(event) => {
                    event.stopPropagation()
                    cancelTrigger(trigger.id)
                  }}
                  size="sm"
                  variant="ghost"
                >
                  Cancel
                </Button>
              </View>
            ) : null}
          </Card>
        </Pressable>
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Overlay />
        <Dialog.Content>
          <Dialog.Close variant="ghost" />
          <View className="mb-4 gap-1.5">
            <Dialog.Title>
              {trigger.symbol}/USD {trigger.direction} ${trigger.targetUsd}
            </Dialog.Title>
            <Dialog.Description>Status: {trigger.status}</Dialog.Description>
          </View>
          <View className="gap-2">
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">
              Amount: {trigger.amountLamports} lamports
            </Text>
            <Text className="text-sm text-neutral-600 dark:text-neutral-300">
              Created: {new Date(trigger.createdAt).toLocaleString()}
            </Text>
            {trigger.firedAt ? (
              <Text className="text-sm text-neutral-600 dark:text-neutral-300">
                Fired: {new Date(trigger.firedAt).toLocaleString()}
              </Text>
            ) : null}
            {trigger.error ? <Text className="text-sm text-red-500">Error: {trigger.error}</Text> : null}
            {trigger.signature ? (
              <>
                <Text className="text-sm text-neutral-600 dark:text-neutral-300" selectable>
                  Signature: {trigger.signature}
                </Text>
                <Button
                  onPress={() => {
                    Clipboard.setString(trigger.signature ?? '')
                    setCopied(true)
                  }}
                  size="sm"
                  variant="outline"
                >
                  {copied ? 'Copied!' : 'Copy signature'}
                </Button>
              </>
            ) : null}
          </View>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog>
  )
}
