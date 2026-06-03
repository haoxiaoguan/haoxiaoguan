import { createHash } from 'node:crypto'

const HEADER_KEYS = ['x-claude-code-session-id', 'x-opencode-session', 'x-session-affinity', 'x-conversation-id']
const BODY_KEYS = ['prompt_cache_key', 'promptCacheKey', 'conversation_id', 'conversationId', 'thread_id', 'threadId', 'session_id', 'sessionId']
const META_KEYS = ['session_id', 'conversation_id']

function rec(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}
function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.trim().length > 0 ? v.trim() : undefined
}

/**
 * 从请求 header + body 提取会话亲和 hint（决定 sticky-lru 命中同一账号）。
 * 优先级：会话 header → body 顶层字段 → body.metadata → 前两条消息内容 SHA256 前 32 hex 兜底。
 * 全无消息 → undefined（不走粘性）。存在 clientKeyId 时前缀化做租户隔离。
 */
export function extractSessionHint(
  headers: Record<string, string>,
  body: unknown,
  clientKeyId?: string,
): string | undefined {
  const raw = pickRaw(headers, body)
  if (raw === undefined) return undefined
  return clientKeyId ? `${clientKeyId.slice(0, 8)}:${raw}` : raw
}

function pickRaw(headers: Record<string, string>, body: unknown): string | undefined {
  for (const k of HEADER_KEYS) {
    const v = str(headers[k])
    if (v !== undefined) return v
  }
  const b = rec(body)
  if (b !== undefined) {
    for (const k of BODY_KEYS) {
      const v = str(b[k])
      if (v !== undefined) return v
    }
    const meta = rec(b.metadata)
    if (meta !== undefined) {
      for (const k of META_KEYS) {
        const v = str(meta[k])
        if (v !== undefined) return v
      }
    }
  }
  return fingerprint(b)
}

function fingerprint(body: Record<string, unknown> | undefined): string | undefined {
  if (body === undefined) return undefined
  const msgs = body.messages
  if (!Array.isArray(msgs) || msgs.length === 0) return undefined
  const parts: string[] = []
  for (const m of msgs.slice(0, 2)) {
    const mr = rec(m)
    if (mr === undefined) continue
    const role = typeof mr.role === 'string' ? mr.role : ''
    const content = typeof mr.content === 'string' ? mr.content : JSON.stringify(mr.content ?? '')
    parts.push(`${role}:${content}`)
  }
  if (parts.length === 0) return undefined
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 32)
}
