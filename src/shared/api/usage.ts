// 活动 / 用量 / 本地备份 DTO（activity · usage · localBackup manifest §6）。

// ── Activity DTOs (activity context — 会话活动统计) ────────────────────────────
export interface ActivityTrendPointResponse {
  date: string
  value: number
}
// 仅返回本次入库的事件数；原设计的 scanned 字段已由单一 watermark 增量机制取代，故省略。
export interface ActivitySyncSummaryResponse {
  events: number
}

// ── Usage DTOs (usage manifest §6) ───────────────────────────────────────────
export interface UsageSyncSummaryResponse {
  imported: number
  failed: number
  platforms: string[]
}

// ── LocalBackup DTOs (localBackup manifest §6) ───────────────────────────────
export interface BackupEntryDto {
  filename: string
  sizeBytes: number
  createdAt: number
}
export interface LocalBackupConfigDto {
  intervalHours: number
  retainCount: number
}
