// 会话历史浏览器的中性数据模型。DTO 经 IPC 传给渲染层。

export type SessionTool = 'claude' | 'claude_desktop' | 'codex' | 'gemini'

export const SESSION_TOOLS: readonly SessionTool[] = ['claude', 'claude_desktop', 'codex', 'gemini']

export interface SessionSummary {
  tool: SessionTool
  sessionId: string
  title?: string | undefined
  summary?: string | undefined
  projectDir?: string | undefined
  createdAt?: number | undefined // epoch 毫秒
  lastActiveAt?: number | undefined // epoch 毫秒；列表按此降序
  sourcePath: string // 定位符（起步为纯文件绝对路径）
  resumeCommand?: string | undefined // 工具不支持恢复时不填
  provider?: string | undefined // Codex:session_meta.payload.model_provider;其它工具留空
  archived?: boolean | undefined // true=已归档(Codex 的 archived_sessions 目录);其它工具不设
}

export interface SessionMessage {
  role: 'user' | 'assistant' | 'tool' | 'system'
  content: string // 已拍平为纯文本
  ts?: number | undefined // epoch 毫秒
}

export interface ToolProbe {
  tool: SessionTool
  hasSessions: boolean
  count: number // 会话文件总数（probe 遍历目录时即得，无需解析内容）
  lastActiveAt?: number | undefined // 该工具最新会话文件 mtime（epoch 毫秒）
}

export interface SessionPage {
  items: SessionSummary[]
  total: number // 该工具扫描到的会话文件总数（用于「还有更多」判断；解析跳过的不从 total 扣减）
  offset: number
}

export const TITLE_MAX_CHARS = 80
export const SUMMARY_MAX_CHARS = 160
