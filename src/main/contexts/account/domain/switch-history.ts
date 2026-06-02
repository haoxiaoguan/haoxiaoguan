// SwitchHistory domain — append-only record of switch operations.
// Defines TriggerType + SwitchHistoryEntry.

import type { PlatformId } from './platform-id'

export type TriggerType = 'manual' | 'auto' | 'websocket'

export interface SwitchHistoryEntry {
  accountId: string
  agentId: PlatformId
  triggerType: TriggerType
  success: boolean
  errorMessage?: string
  switchedAt: Date
}
