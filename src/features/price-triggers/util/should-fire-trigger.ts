import type { TriggerDirection } from '../data-access/trigger-store.ts'

export function shouldFireTrigger(direction: TriggerDirection, currentUsd: number, targetUsd: number): boolean {
  return direction === 'below' ? currentUsd <= targetUsd : currentUsd >= targetUsd
}
