/**
 * AgentDetector —— 从入站 User-Agent 字符串推断 agent 客户端标识。
 *
 * 纯函数，无 I/O。各 CLI 工具有特征串，按优先级匹配。
 * 会话日志扫描源的 agentId 直接用 usage_records.agentId，不走此函数。
 */

/** 特征串 → agentId 映射（按优先级排序，先匹配先返回）。 */
const PATTERNS: ReadonlyArray<{ needle: string; agentId: string }> = [
  { needle: 'claude-cli', agentId: 'claude' },
  { needle: 'codex', agentId: 'codex' },
  { needle: 'gemini', agentId: 'gemini-cli' },
  { needle: 'kiroide', agentId: 'kiro' },
  { needle: 'qoder', agentId: 'qoder' },
]

/**
 * 从 User-Agent 推断 agentId。
 * 大小写不敏感（userAgent 统一 lowercase 后匹配）。
 * 无匹配返回 'unknown'。
 */
export function detectAgent(userAgent: string): string {
  if (!userAgent) return 'unknown'
  const ua = userAgent.toLowerCase()
  for (const { needle, agentId } of PATTERNS) {
    if (ua.includes(needle)) return agentId
  }
  return 'unknown'
}
