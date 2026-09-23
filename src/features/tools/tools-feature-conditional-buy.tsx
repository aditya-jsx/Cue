import { PriceTriggerScreen } from '@/features/price-triggers/ui/price-trigger-screen'

export function ToolsFeatureConditionalBuy() {
  return (
    <PriceTriggerScreen
      defaultDirection="below"
      describe={(symbol, direction) =>
        `When ${symbol}/USD goes ${direction} your target, the session key spends from the approved delegation automatically — no wallet, no user present. Grant delegation first (Home → Buy → Approve).`
      }
      kind="buy"
      title="Conditional Buy"
    />
  )
}
