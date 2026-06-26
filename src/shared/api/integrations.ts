// MCP / 同步 / 会话历史 DTO（mcp · sync · sessions context）。

// ── MCP DTOs (mcp manifest §7) ───────────────────────────────────────────────
export interface McpServerSpec {
  transport: 'stdio' | 'http' | 'sse'
  command: string | null
  args: string[] | null
  env: Record<string, string> | null
  url: string | null
}
export interface McpServerDto {
  id: string
  name: string
  description: string | null
  spec: McpServerSpec
  apps: Record<string, boolean>
  homepage: string | null
  docs: string | null
  tags: string[]
  created_at: number
  updated_at: number
  sort_order: number
}
export interface UnmanagedMcpEntryDto {
  id: string
  name: string
  spec: McpServerSpec
  found_in: string[]
}
export interface UpsertMcpServerRequest {
  id?: string | undefined
  name: string
  description?: string | null | undefined
  transport: 'stdio' | 'http' | 'sse'
  command?: string | null | undefined
  args?: string[] | null | undefined
  env?: Record<string, string> | null | undefined
  url?: string | null | undefined
  apps?: Record<string, boolean> | undefined
  homepage?: string | null | undefined
  docs?: string | null | undefined
  tags?: string[] | undefined
}
export interface ToggleMcpAppRequest {
  server_id: string
  agent_id: string
  enabled: boolean
}
export interface ImportSelectedMcpRequest {
  selections: Array<{ server_id: string; agent_ids: string[] }>
}

// ── Sync DTOs (sync manifest §7) ─────────────────────────────────────────────
export interface WebdavStatus {
  lastSyncAt?: number | null
  lastError?: string | null
  lastErrorSource?: string | null
  lastRemoteEtag?: string | null
}
export interface WebdavConfig {
  enabled: boolean
  baseUrl: string
  username: string
  remoteRoot: string
  profile: string
  autoSync: boolean
  status: WebdavStatus
}
export interface RemoteInfo {
  empty: boolean
  deviceName?: string
  createdAt?: number
  version?: number
  compatible: boolean
}
export interface DownloadResult {
  status: string
  needsRestart: boolean
}
export interface TestConnectionArgs {
  config: WebdavConfig
  password?: string | undefined
  passwordTouched: boolean
}
export interface SaveConfigArgs {
  config: WebdavConfig
  password?: string | undefined
  passwordTouched: boolean
  syncPassword?: string | undefined
  syncPasswordTouched: boolean
}

// ── Sessions DTOs (sessions context — read-only on-disk AI CLI history) ──────
export type SessionToolDto = 'claude' | 'codex' | 'gemini'
export interface SessionSummaryDto {
  tool: SessionToolDto
  sessionId: string
  title?: string
  summary?: string
  projectDir?: string
  createdAt?: number
  lastActiveAt?: number
  sourcePath: string
  resumeCommand?: string
  provider?: string
  archived?: boolean
}
export interface SessionMessageDto {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string
  ts?: number
}
export interface ToolProbeDto {
  tool: SessionToolDto
  hasSessions: boolean
  count: number
  lastActiveAt?: number
}
export interface SessionPageDto {
  items: SessionSummaryDto[]
  total: number
  offset: number
}
export interface CodexProviderCountDto {
  provider: string
  count: number
}
export interface CodexRepairPreviewDto {
  available: boolean
  dbPath?: string
  currentProvider?: string
  currentModel?: string
  counts: CodexProviderCountDto[]
  repairable: number
  codexRunning: boolean
}
export interface CodexRepairRequestDto {
  targetProvider: string
  targetModel?: string | null
  fromProviders?: string[]
  rewriteRollout: boolean
}
export interface CodexRepairResultDto {
  updatedThreads: number
  modelRows: number
  userEventRows: number
  cwdRows: number
  globalStateKeys: number
  changedRollouts: number
  skippedRollouts: number
  backupId: string
}

export interface CodexRepairProgressDto {
  phase: 'scan' | 'backup' | 'rollout' | 'sqlite' | 'globalstate' | 'done'
  percent: number
  message: string
  current?: number
  total?: number
}

export interface SessionDeleteRequestDto {
  tool: SessionToolDto
  sourcePath: string
  sessionId: string
}
export interface SessionDeleteOutcomeDto {
  sourcePath: string
  ok: boolean
  error?: string
}
