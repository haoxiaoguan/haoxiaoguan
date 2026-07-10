// Export/import data structures for export_accounts / import_accounts.
//
// IMPORTANT: these JSON shapes use snake_case keys on
// ExportData/ExportAccount/ExportCredential (NOT camelCase). The export string
// must round-trip through import_from_json byte-compatibly.

export interface ExportCredential {
  token: string
  refresh_token?: string | null
}

export interface ExportAccount {
  id: string
  platform: string
  email: string
  name?: string | null
  tags: string[]
  notes?: string | null
  is_active: boolean
  created_at: string
  last_used_at?: string | null
  // Cursor 专属「额度用尽自动退款」开关（存 account.profilePayload.autoRefundEnabled）。
  // 该偏好不可从 email 现推，故必须显式随导出走，否则导入后会重置为 false。仅在开启时输出，
  // 缺省/false 时省略以保持导出精简；导入端把缺省视为 false。
  auto_refund_enabled?: boolean
  // Omitted from the serialized output when undefined.
  credential?: ExportCredential
}

export interface ExportData {
  version: string
  exported_at: string
  accounts: ExportAccount[]
}

export type ConflictStrategy = 'skip' | 'overwrite' | 'keep_both'

export interface ImportResult {
  imported: number
  skipped: number
  errors: string[]
}
