// 通用 / 设置 / 系统 / Agent DTO。

/** 用量/活动查询窗口：epoch 秒，闭区间。渲染层时间选择器产出，main 侧直接喂 SQLite。 */
export interface TimeWindowDto {
  startSec: number
  endSec: number
}

/** 趋势桶粒度：hour=小时桶，day=日桶。 */
export type TrendGranularityDto = 'hour' | 'day'

export interface SettingsResponse {
  theme: string
  language: string
  closeBehavior: string
  wsPort: number
  refreshIntervals: Record<string, number>
  platformRefreshIntervals: Record<string, number>
  idePaths: Record<string, string>
  quotaRefreshConcurrency: number
  silentStart: boolean
  autostart: boolean
  utilityButtons: string
  allowStaleKiroImport: boolean
  terminalLaunchTemplate: string
  /** 「路由」开关（按客户端）：clientId → 是否经号小管反代转发该客户端第三方供应商。 */
  routingEnabled: Record<string, boolean>
  codexLaunchOnSwitch: boolean
}
export interface AppDirs {
  dataDir: string
  configDir: string
  logDir: string
}
// Result of system.detectAppPath — auto-detected app/IDE path for a platform.
export interface AppPathInfo {
  /** First existing candidate on the current OS, or null if none found. */
  detected: string | null
  /** Representative placeholder path for the current platform+OS. */
  suggestion: string
}

// Per-platform outcome of account.detectActiveAccounts — which stored account
// each IDE is actually logged into (reverse-detected from local login state).
export interface ActiveDetectionResult {
  /** Frontend (kebab) platform id. */
  platform: string
  /** The account id now marked active for this platform, or null. */
  activeAccountId: string | null
  /** True when the detected local identity matched a stored account. */
  matched: boolean
}

// ── Agent DTO (agents manifest §6) ───────────────────────────────────────────
export interface AgentInfo {
  id: string
  displayName: string
  family: string
  capabilities: string[]
}
