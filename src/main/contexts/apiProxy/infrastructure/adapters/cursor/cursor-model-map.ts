// Cursor 模型表 + 路由判定（纯函数）。
// cursor 用自己的命名（版本在前：claude-4.5-sonnet、gpt-5.2、gemini-3-flash-preview 等），
// 与 kiro 的 claude-sonnet-4.5（版本在后）文本不同，不会抢注同名模型。
// 模型清单对齐 9router open-sse/providers/registry/cursor.js。
import type { ModelInfo } from '../../../domain/platform-adapter'

/** cursor 对外暴露的模型 id（含 default=服务端自选）。 */
export const CURSOR_MODELS: ReadonlyArray<{ id: string; displayName: string }> = [
  { id: 'default', displayName: 'Auto (Server Picks)' },
  { id: 'claude-4.5-opus-high-thinking', displayName: 'Claude 4.5 Opus High Thinking' },
  { id: 'claude-4.5-opus-high', displayName: 'Claude 4.5 Opus High' },
  { id: 'claude-4.5-opus', displayName: 'Claude 4.5 Opus' },
  { id: 'claude-4.5-sonnet-thinking', displayName: 'Claude 4.5 Sonnet Thinking' },
  { id: 'claude-4.5-sonnet', displayName: 'Claude 4.5 Sonnet' },
  { id: 'claude-4.5-haiku', displayName: 'Claude 4.5 Haiku' },
  { id: 'claude-4.6-opus-max', displayName: 'Claude 4.6 Opus Max' },
  { id: 'claude-4.6-sonnet-medium-thinking', displayName: 'Claude 4.6 Sonnet Medium Thinking' },
  { id: 'gpt-5.2', displayName: 'GPT 5.2' },
  { id: 'gpt-5.2-codex', displayName: 'GPT 5.2 Codex' },
  { id: 'gpt-5.3-codex', displayName: 'GPT 5.3 Codex' },
  { id: 'gemini-3-flash-preview', displayName: 'Gemini 3 Flash Preview' },
  { id: 'kimi-k2.5', displayName: 'Kimi K2.5' },
]

const CURSOR_MODEL_IDS: ReadonlySet<string> = new Set(CURSOR_MODELS.map((m) => m.id))

/** cursor 命名前缀（版本在前）+ composer；用于裸路由模型感知，避免误判 kiro 的 claude-sonnet-* 命名。 */
const CURSOR_MODEL_PATTERN = /^(claude-\d|gpt-5|gemini-3|kimi-|composer(?:-|$)|default$)/i

/** 该平台是否支持某模型名（精确命中清单，或命中 cursor 命名前缀）。 */
export function supportsCursorModel(model: string): boolean {
  const id = model.trim().toLowerCase()
  if (id.length === 0) return false
  if (CURSOR_MODEL_IDS.has(id)) return true
  return CURSOR_MODEL_PATTERN.test(id)
}

/**
 * 把客户端模型名映射为 cursor 上游接受的 model id。
 * cursor 直接吃自己的 id，故：命中清单 → 原样；命中 cursor 命名前缀 → 原样透传（容忍清单外新模型）；
 * 完全不认 → 'default'（服务端自选，绝不 throw）。
 */
export function mapCursorModelId(model: string): string {
  const id = model.trim()
  if (id.length === 0) return 'default'
  const lower = id.toLowerCase()
  if (CURSOR_MODEL_IDS.has(lower)) return lower
  if (CURSOR_MODEL_PATTERN.test(lower)) return id
  return 'default'
}

/** composer 系模型（thinking 里夹带可见正文，需特殊抽取）。 */
export function isComposerModel(model: string): boolean {
  const id = String(model || '').split('/').pop() ?? ''
  return /^composer(?:-|$)/i.test(id)
}

/** /v1/models 下发用的模型信息列表。 */
export function listCursorModels(): ModelInfo[] {
  return CURSOR_MODELS.map((m) => ({
    id: m.id,
    displayName: m.displayName,
    supportsThinking: /thinking/i.test(m.id),
    ownedBy: 'cursor',
  }))
}
