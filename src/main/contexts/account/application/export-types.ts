// Export/import data structures for export_accounts / import_accounts.
//
// IMPORTANT: these JSON shapes use snake_case keys to mirror the source serde
// default on ExportData/ExportAccount/ExportCredential (NOT camelCase). The
// export string must round-trip through import_from_json byte-compatibly.

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
  // Omitted from the serialized output when undefined (serde skip_serializing_if).
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
