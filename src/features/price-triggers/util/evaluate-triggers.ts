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
  spendDelegation,
  stopBuyTriggers,
} from '@/features/price-triggers/data-access/trigger-store'
import { $prices, type PricePoint, type Symbol } from '@/features/prices/data-access/price-store'
import { isPriceFresh } from '@/features/prices/util/price-freshness'
import { formatPct } from '@/features/price-triggers/util/format-pct'
import { shouldFireTrigger } from '@/features/price-triggers/util/should-fire-trigger'
import { executeAutonomousAction } from '@/features/wallet/util/execute-autonomous-action'
import CueNative from '../../../../modules/cue-native'

// Symbols whose feed is currently stale, so the log gets one entry per outage and not one every poll.
const staleSymbols = new Set<Symbol>()

/** True when the price is recent enough to act on. A stalled feed pauses rules instead of firing on old data. */
function isFresh(symbol: Symbol, point: PricePoint, maxAgeMs: number): boolean {
  const now = Date.now()
  if (isPriceFresh(point.publishTimeMs, now, maxAgeMs)) {
    staleSymbols.delete(symbol)
    return true
  }
  if (!staleSymbols.has(symbol)) {
    staleSymbols.add(symbol)
    const minutes = Math.round((now - point.publishTimeMs) / 60_000)
    pushLogEntry({
      amount: '—',
      detail: `${symbol}'s price is ${minutes} min old. Rules wait for a fresh price.`,
      status: 'Alert',
      title: 'Price feed is stale',
    })
  }
  return false
}

/** Checks every active rule against the latest prices; buys spend via the session key, guards alert or pause. */
export async function evaluateTriggers(client: SolanaClient, maxPriceAgeMs: number): Promise<void> {
  const prices = $prices.get()
  for (const trigger of $triggers.get().filter((t) => t.status === 'active')) {
    if (trigger.kind === 'buy') await evaluateBuy(client, trigger, prices[trigger.symbol], maxPriceAgeMs)
    else evaluateGuard(trigger, prices.SOL, maxPriceAgeMs)
  }
}

async function evaluateBuy(
  client: SolanaClient,
  trigger: BuyTrigger,
  point: PricePoint | undefined,
  maxPriceAgeMs: number,
) {
  const { title } = describeTrigger(trigger)
  if (trigger.expiresAt && Date.now() > trigger.expiresAt) {
    markTriggerExpired(trigger.id)
    pushLogEntry({ amount: '—', detail: 'Expired without the price being hit', status: 'Alert', title })
    return
  }
  if (!point || !isFresh(trigger.symbol, point, maxPriceAgeMs)) return
  if (!shouldFireTrigger(trigger.direction, point.usd, trigger.targetUsd)) return

  const spent = `${(Number(trigger.amountLamports) / 1e9).toFixed(4)} WSOL`
  try {
    const result = await executeAutonomousAction({
      client,
      ownerAddress: address(trigger.ownerAddress),
      transferLamports: BigInt(trigger.amountLamports),
    })
    markTriggerFired(trigger.id, result.signature)
    spendDelegation(BigInt(trigger.amountLamports))
    pushLogEntry({
      amount: spent,
      detail: `${trigger.symbol} hit ${formatUsd(point.usd)}`,
      signature: result.signature,
      status: 'Confirmed',
      title: `Bought: ${title}`,
    })
    CueNative.notify('Cue bought for you', `${title} — ${trigger.symbol} is at ${formatUsd(point.usd)}.`)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    markTriggerFailed(trigger.id, message)
    pushLogEntry({ amount: '—', detail: message, status: 'Alert', title: `Couldn't buy: ${title}` })
    CueNative.notify("Cue couldn't complete a buy", message)
  }
}

// ponytail: tumbling window (baseline resets each window), so a drop straddling two windows can be missed; keep a
// price history and compare against the window's max if that ever matters.
function evaluateGuard(trigger: GuardTrigger, sol: PricePoint | undefined, maxPriceAgeMs: number) {
  if (!sol || !isFresh('SOL', sol, maxPriceAgeMs)) return
  if (Date.now() - trigger.baselineAt > trigger.windowMs) {
    rebaselineGuard(trigger.id, sol.usd)
    return
  }
  const dropPct = ((trigger.baselineUsd - sol.usd) / trigger.baselineUsd) * 100
  if (dropPct < trigger.thresholdPct) return

  // The wallet holds SOL, so a SOL price drop is the portfolio drop (the user's own transfers aren't a market move).
  markTriggerFired(trigger.id)
  const paused = trigger.action === 'pause_activity' ? stopBuyTriggers('Paused by Portfolio Guard') : 0
  const detail = `SOL fell ${formatPct(dropPct)} to ${formatUsd(sol.usd)}${
    trigger.action === 'pause_activity' ? ` — paused ${paused} buy rule${paused === 1 ? '' : 's'}` : ''
  }`
  pushLogEntry({ amount: `-${formatPct(dropPct)}`, detail, status: 'Alert', title: 'Guard triggered' })
  CueNative.notify('Portfolio Guard triggered', detail)
}
