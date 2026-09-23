import { useMobileWallet } from '@wallet-ui/react-native-kit'
import { Button } from 'heroui-native/button'
import { Card } from 'heroui-native/card'
import { useState } from 'react'
import { View } from 'react-native'

import { useAppCluster } from '@/features/cluster/data-access/cluster-provider'
import { ShellUiPage } from '@/features/shell/ui/shell-ui-page'
import { executeAutonomousAction } from '@/features/wallet/util/execute-autonomous-action'
import { formatError } from '@/features/wallet/util/format-error'
import { WalletUiConnectButton } from '@/features/wallet/ui/wallet-ui-connect-button'

export function ToolsFeatureAutonomousAction() {
  const { account, connect } = useMobileWallet()
  const { client } = useAppCluster()
  const [status, setStatus] = useState<string | null>(null)
  const [pending, setPending] = useState(false)

  async function run() {
    if (!account || pending) return
    setPending(true)
    setStatus(null)
    try {
      const result = await executeAutonomousAction({ client, ownerAddress: account.address })
      setStatus(`Landed: ${result.signature}`)
    } catch (e) {
      setStatus(formatError(e))
    } finally {
      setPending(false)
    }
  }

  return (
    <ShellUiPage>
      {account ? (
        <Card className="gap-3 p-5">
          <Card.Title className="text-xl font-bold">Autonomous action</Card.Title>
          <Card.Description className="leading-relaxed">
            Spends 0.01 WSOL from the approved delegation using the session key alone — no wallet, no Phantom, no user
            present. Grant delegation first (Home → Buy → Approve) or this will fail with &ldquo;No session key
            found.&rdquo;
          </Card.Description>
          <View className="mt-2">
            <Button isDisabled={pending} onPress={run}>
              {pending ? 'Running…' : 'Run autonomous action'}
            </Button>
          </View>
          {status ? <Card.Description className="leading-relaxed">{status}</Card.Description> : null}
        </Card>
      ) : (
        <WalletUiConnectButton connect={connect} size="lg">
          Connect Wallet
        </WalletUiConnectButton>
      )}
    </ShellUiPage>
  )
}
