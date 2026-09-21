import { transact } from '@solana-mobile/mobile-wallet-adapter-protocol-kit'
import type { Address, GetLatestBlockhashApi, Rpc, TransactionSendingSigner } from '@solana/kit'
import type { AppIdentity } from '@wallet-ui/react-native-kit'

import { refreshBlockhash } from '@/features/wallet/util/refresh-blockhash'

export interface CreateFreshAuthorizeSignerOptions {
  address: Address
  chain: `${string}:${string}`
  identity: AppIdentity
  minContextSlot: bigint
  rpc: Rpc<GetLatestBlockhashApi>
}

/**
 * Signs and sends in ONE wallet session: fresh `authorize`, then `signAndSendTransactions`.
 *
 * Phantom declines `reauthorize` (cached auth token) for apps it has not verified, and wallet-ui's own fresh-authorize
 * fallback never fires in this app (its error check fails at runtime although the error is a protocol error, code -1).
 * A fresh authorize is accepted, at the cost of an extra wallet prompt per send.
 * ponytail: always fresh; try the stored token first once wallets that verify Cue (Seed Vault) are confirmed to accept it.
 */
// ponytail: dev-only guard. Cue is tested on devnet/testnet until the v1 is done; remove this allowlist to ship mainnet.
const DEV_CHAINS = ['solana:devnet', 'solana:testnet']

export function createFreshAuthorizeSigner({
  address,
  chain,
  identity,
  minContextSlot,
  rpc,
}: CreateFreshAuthorizeSignerOptions): TransactionSendingSigner {
  if (!DEV_CHAINS.includes(chain)) {
    throw new Error(`Cue only signs on devnet or testnet until v1 (got "${chain}").`)
  }
  return {
    address,
    signAndSendTransactions: async (transactions) =>
      await transact(async (wallet) => {
        await wallet.authorize({ chain, identity })
        // The connect step can take a while; re-stamp so the blockhash is fresh when the wallet signs.
        return await wallet.signAndSendTransactions({
          minContextSlot: Number(minContextSlot),
          transactions: await refreshBlockhash(transactions, rpc),
        })
      }),
  }
}
