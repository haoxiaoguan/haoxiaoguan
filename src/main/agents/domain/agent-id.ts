// AgentId enum — mirrors Rust agents::domain::agent_id.
// String values are snake_case as serialised in JSON (apps_json column, IPC args).

export type AgentId =
  | 'cursor'
  | 'windsurf'
  | 'antigravity'
  | 'kiro'
  | 'github_copilot'
  | 'codebuddy'
  | 'codebuddy_cn'
  | 'qoder'
  | 'trae'
  | 'zed'
  | 'codex'
  | 'gemini_cli'
  | 'claude'
  | 'claude_desktop'
  | 'gemini'
  | 'opencode'
  | 'hermes'

export const ALL_AGENT_IDS: readonly AgentId[] = [
  'cursor',
  'windsurf',
  'antigravity',
  'kiro',
  'github_copilot',
  'codebuddy',
  'codebuddy_cn',
  'qoder',
  'trae',
  'zed',
  'codex',
  'gemini_cli',
  'claude',
  'claude_desktop',
  'gemini',
  'opencode',
  'hermes',
] as const

const AGENT_ID_SET = new Set<string>(ALL_AGENT_IDS)

export function parseAgentId(s: string): AgentId {
  if (AGENT_ID_SET.has(s)) return s as AgentId
  throw new Error(`unknown agent id: '${s}'`)
}

export function isAgentId(s: string): s is AgentId {
  return AGENT_ID_SET.has(s)
}
