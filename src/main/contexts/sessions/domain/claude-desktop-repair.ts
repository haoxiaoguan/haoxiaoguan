// Claude Desktop Code 会话索引修复领域类型。
// Desktop 的真实 transcript 仍在 ~/.claude/projects；本修复只补
// Application Support/Claude/claude-code-sessions/<namespace>/local_*.json 索引。

export interface ClaudeDesktopNamespaceSummary {
  /** 两层 namespace：<accountLikeId>/<workspaceLikeId>。 */
  key: string
  accountId: string
  workspaceId: string
  codeSessionCount: number
  latestCodeSessionAt?: number
  localAgentTouchedAt?: number
}

export interface ClaudeDesktopRepairPreview {
  available: boolean
  appDataDir: string
  codeSessionsDir: string
  namespaces: ClaudeDesktopNamespaceSummary[]
  currentNamespace?: ClaudeDesktopNamespaceSummary
  sourceNamespaces: ClaudeDesktopNamespaceSummary[]
  repairable: number
  desktopRunning: boolean
}

export interface ClaudeDesktopRepairRequest {
  targetNamespace?: string
  sourceNamespaces?: string[]
}

export interface ClaudeDesktopRepairResult {
  copied: number
  skippedExisting: number
  backupId: string
  targetNamespace: string
  sourceNamespaces: string[]
}
