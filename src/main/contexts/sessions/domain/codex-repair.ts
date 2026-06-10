// Codex 会话修复领域类型。Codex 的 resume/Desktop 按当前默认 provider 过滤
// state_*.sqlite 的 threads.model_provider;切换 provider 后旧会话被过滤不可见。
// 修复 = 把目标会话的 model_provider 同步成当前默认 provider(SQLite + 可选 rollout)。

export interface CodexProviderCount {
  provider: string
  count: number
}

export interface CodexRepairPreview {
  /** 是否检测到可修复的 Codex 库(存在 state_*.sqlite 且含 threads 表)。 */
  available: boolean
  dbPath?: string
  /** config.toml 顶层 model_provider(修复目标默认值)。 */
  currentProvider?: string
  /** 各 provider 的会话数(archived=0)。 */
  counts: CodexProviderCount[]
  /** provider != currentProvider 的会话数(即「看不到」的会话)。 */
  repairable: number
  /** Codex App 是否在运行(运行中需先停才能安全写)。 */
  codexRunning: boolean
}

export interface CodexRepairRequest {
  /** 目标 provider(归并到此)。 */
  targetProvider: string
  /** 仅修复这些 provider 的会话;省略 = 所有 != targetProvider。 */
  fromProviders?: string[]
  /** 是否同时改写 rollout 文件首行 model_provider。 */
  rewriteRollout: boolean
}

export interface CodexRepairResult {
  updatedThreads: number
  rewrittenRollouts: number
  skippedRollouts: number
  /** 备份 id,用于回滚。 */
  backupId: string
}

/** 修复一条 thread 需要的最小信息(rollout 改写用)。 */
export interface CodexThreadRef {
  id: string
  rolloutPath: string
  provider: string
}
