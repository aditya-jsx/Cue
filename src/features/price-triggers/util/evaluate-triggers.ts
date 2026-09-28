import { address } from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { pushLogEntry } from '@/features/cue/data-access/cue-store'
import {
  $triggers,
  type BuyTrigger,
  describeTrigger,
  formatUsd,
  type GuardTrigger,
  markTriggerExpired,
  markTriggerFailed,
  markTriggerFired,
  rebaselineGuard,
  stopBuyTriggers,
} from '@/features/price-triggers/data-access/trigger-store'
import { $prices, type PricePoint } from '@/features/prices/data-access/price-store'
import { shouldFireTrigger } from '@/features/price-triggers/util/should-fire-trigger'
import { executeAutonomousAction } from '@/features/wallet/util/execute-autonomous-action'
import CueNative from '../../../../modules/cue-native'

/** Checks every active rule against the latest prices; buys spend via the session key, guards alert or pause. */
export async function evaluateTriggers(client: SolanaClient): Promise<void> {
  const prices = $prices.get()
  for (const trigger of $triggers.get().filter((t) => t.status === 'active')) {
    if (trigger.kind === 'buy') await evaluateBuy(client, trigger, prices[trigger.symbol])
    else evaluateGuard(trigger, prices.SOL)
  }
}

async function evaluateBuy(client: SolanaClient, trigger: BuyTrigger, point: PricePoint | undefined) {
  const { title } = describeTrigger(trigger)
  if (trigger.expiresAt && Date.now() > trigger.expiresAt) {
    markTriggerExpired(trigger.id)
    pushLogEntry({ amount: '—', detail: 'Expired without the price being hit', status: 'Alert', title })
    return
  }
  if (!point || !shouldFireTrigger(trigger.direction, point.usd, trigger.targetUsd)) return

  const spent = `${(Number(trigger.amountLamports) / 1e9).toFixed(4)} WSOL`
  try {
    const result = await executeAutonomousAction({
      client,
      ownerAddress: address(trigger.ownerAddress),
      transferLamports: BigInt(trigger.amountLamports),
    })
    markTriggerFired(trigger.id, result.signature)
    pushLogEntry({
      amount: spent,
      detail: `Just now — ${trigger.symbol} hit ${formatUsd(point.usd)}`,
      signature: result.signature,
      status: 'Confirmed',
      title: `Bought: ${title}`,
    })
    CueNative.notify('Cue bought for you', `${title} — ${trigger.symbol} is at ${formatUsd(point.usd)}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markTriggerFailed(trigger.id, message)
    pushLogEntry({ amount: '—', detail: `Just now — ${message}`, status: 'Alert', title: `Couldn't buy: ${title}` })
    CueNative.notify("Cue couldn't complete a buy", message)
  }
}

// ponytail: tumbling window (baseline resets each window), so a drop straddling two windows can be missed; keep a
// price history and compare against the window's max if that ever matters.
function evaluateGuard(trigger: GuardTrigger, sol: PricePoint | undefined) {
  if (!sol) return
  if (Date.now() - trigger.baselineAt > trigger.windowMs) {
    rebaselineGuard(trigger.id, sol.usd)
    return
  }
  const dropPct = ((trigger.baselineUsd - sol.usd) / trigger.baselineUsd) * 100
  if (dropPct < trigger.thresholdPct) return

  // The wallet holds SOL, so a SOL price drop is the portfolio drop (the user's own transfers aren't a market move).
  markTriggerFired(trigger.id)
  const paused = trigger.action === 'pause_activity' ? stopBuyTriggers('Paused by Portfolio Guard') : 0
  const detail = `SOL fell ${dropPct.toFixed(1)}% to ${formatUsd(sol.usd)}${
    trigger.action === 'pause_activity' ? ` — paused ${paused} buy rule${paused === 1 ? '' : 's'}` : ''
  }`
  pushLogEntry({ amount: `-${dropPct.toFixed(1)}%`, detail: `Just now — ${detail}`, status: 'Alert', title: 'Guard triggered' })
  CueNative.notify('Portfolio Guard triggered', detail)
}
