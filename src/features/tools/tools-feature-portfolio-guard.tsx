import { PriceTriggerScreen } from '@/features/price-triggers/ui/price-trigger-screen'

export function ToolsFeaturePortfolioGuard() {
  return (
    <PriceTriggerScreen
      defaultDirection="below"
      describe={(symbol, direction) =>
        `Protects your position: when ${symbol}/USD goes ${direction} your stop price, the session key exits automatically from the approved delegation — no wallet, no user present. Grant delegation first (Home → Buy → Approve).`
      }
      kind="guard"
      title="Portfolio Guard"
    />
  )
}
