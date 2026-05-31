import type { SwitchHistoryEntry } from './switch-history'

// SwitchHistoryRepository port — append-only audit log.
// 对应 SwitchHistoryRepository trait.
export interface SwitchHistoryRepository {
  record(entry: SwitchHistoryEntry): Promise<void>
  /** Most recent entries, ordered by switched_at DESC, limited by count. */
  findRecent(limit: number): Promise<SwitchHistoryEntry[]>
}
