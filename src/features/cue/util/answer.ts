import { address } from '@solana/kit'

import type { SolanaClient } from '@/features/cluster/data-access/create-solana-client'
import { describeTrigger, formatUsd, type PriceTrigger } from '@/features/price-triggers/data-access/trigger-store'
import type { PricePoint, Symbol } from '@/features/prices/data-access/price-store'
import { spokenPrice } from '@/features/cue/util/spoken'
import { BUYABLE_TOKENS } from '@/features/wallet/util/tokens'

const TOKEN_PROGRAM = address('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA')
const SPOKEN_NAME: Record<string, string> = { JUP: 'Jupiter', SKR: 'Seeker', SOL: 'SOL' }
const amount = (n: number) => Number(n.toFixed(n >= 1 ? 2 : 4)).toString()

/** Answers a question about the user's own wallet: what to show, and the same thing written for the ear. */
export async function answerQuestion({
  client,
  owner,
  prices,
  question,
  rules,
  symbol,
}: {
  client: SolanaClient
  owner: string
  prices: Partial<Record<Symbol, PricePoint>>
  question: 'balance' | 'price' | 'rules'
  rules: PriceTrigger[]
  symbol?: Symbol
}): Promise<{ spoken: string; text: string }> {
  if (question === 'rules') {
    if (!rules.length) return { spoken: "You don't have any rules or alerts set.", text: 'No rules or alerts set.' }
    const titles = rules.map((r) => describeTrigger(r).title)
    const count = `You have ${rules.length} ${rules.length === 1 ? 'rule' : 'rules'}`
    return { spoken: `${count}: ${titles.join('. ')}.`, text: `${count}:\n${titles.map((t) => `• ${t}`).join('\n')}` }
  }

  if (question === 'price') {
    const point = symbol ? prices[symbol] : undefined
    if (!symbol || !point) return { spoken: "I don't have that price yet.", text: "I don't have that price yet." }
    return {
      spoken: `${SPOKEN_NAME[symbol]} is ${spokenPrice(point.usd)}.`,
      text: `${symbol} is ${formatUsd(point.usd)}`,
    }
  }

  const token = symbol && symbol !== 'SOL' ? BUYABLE_TOKENS[symbol] : undefined
  let held: number
  if (token) {
    // By token program, not by mint: a mint that doesn't exist on this cluster (JUP on devnet) is an RPC error,
    // where it should just mean "you hold none".
    const { value } = await client.rpc
      .getTokenAccountsByOwner(address(owner), { programId: TOKEN_PROGRAM }, { encoding: 'jsonParsed' })
      .send()
    type Parsed = { parsed: { info: { mint: string; tokenAmount: { uiAmount: number | null } } } }
    held = value
      .map((a) => (a.account.data as unknown as Parsed).parsed.info)
      .filter((info) => info.mint === token.mint)
      .reduce((sum, info) => sum + (info.tokenAmount.uiAmount ?? 0), 0)
  } else {
    held = Number((await client.rpc.getBalance(address(owner)).send()).value) / 1e9
  }
  const name = symbol ?? 'SOL'
  const usd = prices[name] ? held * prices[name]!.usd : null
  const worth = usd !== null ? ` (${formatUsd(usd)})` : ''
  const spokenWorth = usd !== null && usd > 0 ? `, about ${spokenPrice(usd)}` : ''
  return {
    spoken:
      held > 0
        ? `You have ${amount(held)} ${SPOKEN_NAME[name]}${spokenWorth}.`
        : `You don't hold any ${SPOKEN_NAME[name]}.`,
    text: `${amount(held)} ${name}${worth}`,
  }
}
