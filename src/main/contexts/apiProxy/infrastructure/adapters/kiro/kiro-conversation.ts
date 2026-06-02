// Kiro 会话清洗（纯函数）。保证 CodeWhisperer 后端硬约束，否则 400：
//   user 起、user 止、严格交替、每个 assistant.toolUses 都有紧邻 user.toolResults 配对（缺失合成失败占位）、
//   无空 content 的 user（除非带 toolResults）。
// 同时把 IR 多轮映射成 Kiro history，并提供 toolResult 文本字节截断。
// 参考：参考实现 线协议模块 的 sanitizeConversation 及其子步骤（按线协议重写）。
import type { CanonicalMessage, ContentBlock } from '../../../domain/canonical'
import type {
  KiroHistoryMessage,
  KiroToolResult,
  KiroToolUse,
} from './kiro-wire-types'

// ---- 占位消息（与参考同义） ----
const HELLO_USER: KiroHistoryMessage = { userInputMessage: { content: 'Hello' } }
const CONTINUE_USER: KiroHistoryMessage = { userInputMessage: { content: 'Continue' } }
const UNDERSTOOD_ASSIST: KiroHistoryMessage = { assistantResponseMessage: { content: 'understood' } }

function failedToolResult(toolUseId: string): KiroToolResult {
  return { toolUseId, content: [{ text: 'Tool execution failed' }], status: 'error' }
}

function failedToolResultUser(toolUseIds: string[]): KiroHistoryMessage {
  return {
    userInputMessage: { content: '', userInputMessageContext: { toolResults: toolUseIds.map(failedToolResult) } },
  }
}

// ---- 谓词 ----
function isUser(m: KiroHistoryMessage): boolean {
  return m.userInputMessage != null
}
function isAssistant(m: KiroHistoryMessage): boolean {
  return m.assistantResponseMessage != null
}
function hasToolUses(m: KiroHistoryMessage): boolean {
  return (m.assistantResponseMessage?.toolUses?.length ?? 0) > 0
}
function hasToolResults(m: KiroHistoryMessage): boolean {
  return (m.userInputMessage?.userInputMessageContext?.toolResults?.length ?? 0) > 0
}

// ============ IR → Kiro history ============

// 把一条 IR 消息的 text 块拼成单字符串（'\n' 连接）。
function joinText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

function extractToolUses(content: ContentBlock[]): KiroToolUse[] {
  const out: KiroToolUse[] = []
  for (const b of content) {
    if (b.type === 'tool_use') out.push({ toolUseId: b.id, name: b.name, input: b.input })
  }
  return out
}

function extractToolResults(content: ContentBlock[]): KiroToolResult[] {
  const out: KiroToolResult[] = []
  for (const b of content) {
    if (b.type !== 'tool_result') continue
    const texts = b.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
    const text = texts.join('\n')
    // 空 content 占位为单空格（Kiro 要求 toolResult.content 非空）。消化 M2a 遗留的空 tool_result 语义。
    out.push({
      toolUseId: b.toolUseId,
      content: [{ text: text.length > 0 ? text : ' ' }],
      status: b.isError === true ? 'error' : 'success',
    })
  }
  return out
}

/**
 * IR 多轮 → Kiro history。user→userInputMessage（含 toolResults），assistant→assistantResponseMessage（含 toolUses）。
 * 注意：tools 不在此层挂载（tools 仅挂当前消息，由 buildConversationState 处理）。
 */
export function irMessagesToKiroHistory(messages: CanonicalMessage[]): KiroHistoryMessage[] {
  return messages.map((m) => {
    if (m.role === 'assistant') {
      const toolUses = extractToolUses(m.content)
      return {
        assistantResponseMessage: {
          content: joinText(m.content),
          ...(toolUses.length > 0 ? { toolUses } : {}),
        },
      }
    }
    const toolResults = extractToolResults(m.content)
    return {
      userInputMessage: {
        content: joinText(m.content),
        ...(toolResults.length > 0 ? { userInputMessageContext: { toolResults } } : {}),
      },
    }
  })
}

// ============ 清洗子步骤 ============

function ensureStartsWithUser(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length === 0 || isUser(messages[0])) return messages
  return [HELLO_USER, ...messages]
}

function ensureEndsWithUser(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length === 0) return [HELLO_USER]
  if (isUser(messages[messages.length - 1])) return messages
  return [...messages, CONTINUE_USER]
}

// 剔除空 content 且无 toolResults 的 user（保留首条 user，避免清空对话）。
function removeEmptyUsers(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length <= 1) return messages
  const firstUserIdx = messages.findIndex(isUser)
  return messages.filter((m, idx) => {
    if (isAssistant(m)) return true
    if (isUser(m) && idx === firstUserIdx) return true
    if (isUser(m)) {
      const nonEmpty = (m.userInputMessage?.content ?? '').trim().length > 0
      return nonEmpty || hasToolResults(m)
    }
    return true
  })
}

// 每个 assistant.toolUses 后必须紧跟 user.toolResults 配对所有 id；缺失/不全则合成失败占位。
function ensureToolUsesPaired(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  const result: KiroHistoryMessage[] = []
  for (let i = 0; i < messages.length; i++) {
    const m = messages[i]
    result.push(m)
    if (!(isAssistant(m) && hasToolUses(m))) continue

    const toolUses = m.assistantResponseMessage?.toolUses ?? []
    const toolUseIds = toolUses.map((tu, idx) => tu.toolUseId || `toolUse_${idx + 1}`)
    const next = i + 1 < messages.length ? messages[i + 1] : null

    if (!next || !isUser(next) || !hasToolResults(next)) {
      // 无紧邻 toolResults → 合成一条全失败占位 user。
      result.push(failedToolResultUser(toolUseIds))
      continue
    }

    // 有紧邻 toolResults → 补齐缺失 id 的失败占位，保留已存在的有效结果。
    const existing = next.userInputMessage?.userInputMessageContext?.toolResults ?? []
    const validIds = new Set(toolUseIds)
    const seen = new Set<string>()
    const merged: KiroToolResult[] = []
    for (const tr of existing) {
      if (tr.toolUseId && validIds.has(tr.toolUseId) && !seen.has(tr.toolUseId)) {
        seen.add(tr.toolUseId)
        merged.push(tr)
      }
    }
    for (const id of toolUseIds) {
      if (!seen.has(id)) merged.push(failedToolResult(id))
    }
    result.push({
      userInputMessage: { ...next.userInputMessage!, userInputMessageContext: { ...next.userInputMessage!.userInputMessageContext, toolResults: merged } },
    })
    i++ // 已消费 next
  }
  return result
}

// 在两个连续同角色消息间插入占位，保证严格交替。
function ensureAlternating(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  if (messages.length <= 1) return messages
  const result: KiroHistoryMessage[] = [messages[0]]
  for (let i = 1; i < messages.length; i++) {
    const prev = result[result.length - 1]
    const cur = messages[i]
    if (isUser(prev) && isUser(cur)) result.push(UNDERSTOOD_ASSIST)
    else if (isAssistant(prev) && isAssistant(cur)) result.push(CONTINUE_USER)
    result.push(cur)
  }
  return result
}

// 校验：不合法则抛错（buildConversationState 据此 fail-loud）。
function validateConversation(messages: KiroHistoryMessage[]): void {
  const errors: string[] = []
  if (messages.length === 0 || !isUser(messages[0])) errors.push('STARTS_WITH_USER')
  if (messages.length === 0 || !isUser(messages[messages.length - 1])) errors.push('ENDS_WITH_USER')
  for (let i = 1; i < messages.length; i++) {
    if (isUser(messages[i - 1]) && isUser(messages[i])) { errors.push(`ALTERNATING:${i}`); break }
    if (isAssistant(messages[i - 1]) && isAssistant(messages[i])) { errors.push(`ALTERNATING:${i}`); break }
  }
  for (let i = 0; i < messages.length - 1; i++) {
    if (isAssistant(messages[i]) && hasToolUses(messages[i])) {
      const next = messages[i + 1]
      if (!isUser(next) || !hasToolResults(next)) { errors.push(`TOOL_USES_UNPAIRED:${i}`); break }
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid Kiro conversation after sanitization: ${errors.join(', ')}`)
  }
}

/**
 * 清洗 history。固定步骤序（顺序敏感）：
 * 起始补 user → 去空 user → toolUse 配对 → 交替补占位 → 结尾补 user → 校验。
 */
export function sanitizeConversation(messages: KiroHistoryMessage[]): KiroHistoryMessage[] {
  let out = [...messages]
  out = ensureStartsWithUser(out)
  out = removeEmptyUsers(out)
  out = ensureToolUsesPaired(out)
  out = ensureAlternating(out)
  out = ensureEndsWithUser(out)
  validateConversation(out)
  return out
}

// ============ 字节截断 ============

// 按 UTF-8 字节安全截断到 maxBytes 内（不切碎多字节字符）。
function sliceByBytes(text: string, maxBytes: number): string {
  const buf = Buffer.from(text, 'utf-8')
  if (buf.byteLength <= maxBytes) return text
  let end = maxBytes
  // 回退到不切碎 UTF-8 continuation byte（0b10xxxxxx）的边界。
  while (end > 0 && (buf[end] & 0xc0) === 0x80) end--
  return buf.subarray(0, end).toString('utf-8')
}

/**
 * 对 history 里每条 user.toolResults[].content[].text，超 maxBytes 的按字节截断并加标记。
 * 返回新数组（不可变）；未超限的原样保留引用。
 */
export function truncateToolResultText(
  messages: KiroHistoryMessage[],
  maxBytes: number,
): KiroHistoryMessage[] {
  return messages.map((m) => {
    const results = m.userInputMessage?.userInputMessageContext?.toolResults
    if (!results || results.length === 0) return m
    let changed = false
    const newResults = results.map((tr) => {
      const newContent = tr.content.map((c) => {
        if (c.text !== undefined && Buffer.byteLength(c.text, 'utf-8') > maxBytes) {
          changed = true
          const original = c.text.length
          return { ...c, text: `${sliceByBytes(c.text, maxBytes)}\n\n[Truncated by proxy: original ${original} chars]` }
        }
        return c
      })
      return changed ? { ...tr, content: newContent } : tr
    })
    if (!changed) return m
    return {
      userInputMessage: { ...m.userInputMessage!, userInputMessageContext: { ...m.userInputMessage!.userInputMessageContext, toolResults: newResults } },
    }
  })
}
