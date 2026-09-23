import { address } from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { $triggers, markTriggerFailed, markTriggerFired } from '@/features/price-triggers/data-access/trigger-store'
import { $prices } from '@/features/prices/data-access/price-store'
import { executeAutonomousAction } from '@/features/wallet/util/execute-autonomous-action'
import { shouldFireTrigger } from '@/features/price-triggers/util/should-fire-trigger'

/** Checks every active trigger against the latest prices and fires the autonomous action for any that are met. */
export async function evaluateTriggers(client: SolanaClient): Promise<void> {
  const prices = $prices.get()
  const activeTriggers = $triggers.get().filter((trigger) => trigger.status === 'active')

  for (const trigger of activeTriggers) {
    const point = prices[trigger.symbol]
    if (!point) continue

    if (!shouldFireTrigger(trigger.direction, point.usd, trigger.targetUsd)) continue

    try {
      const result = await executeAutonomousAction({
        client,
        ownerAddress: address(trigger.ownerAddress),
        transferLamports: BigInt(trigger.amountLamports),
      })
      markTriggerFired(trigger.id, result.signature)
    } catch (error) {
      markTriggerFailed(trigger.id, error instanceof Error ? error.message : String(error))
    }
  }
}
