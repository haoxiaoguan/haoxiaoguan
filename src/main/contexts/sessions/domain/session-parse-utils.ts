import { TITLE_MAX_CHARS } from './session'

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** 时间戳归一为 epoch 毫秒。数字 >1e12 视为毫秒，否则视为秒 ×1000；字符串按 RFC3339（Date.parse）。 */
export function parseTimestampToMs(value: unknown): number | undefined {
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) return undefined
    return value > 1_000_000_000_000 ? Math.trunc(value) : Math.trunc(value * 1000)
  }
  if (typeof value === 'string') {
    const t = value.trim()
    if (t.length === 0) return undefined
    const ms = Date.parse(t)
    return Number.isNaN(ms) ? undefined : ms
  }
  return undefined
}

/** 把多模态 content 拍平为纯文本。工具调用渲染为 [Tool: name]，工具结果取嵌套 content。 */
export function extractText(value: unknown): string {
  if (typeof value === 'string') return value
  if (Array.isArray(value)) {
    return value
      .map(extractTextFromItem)
      .filter((s) => s.length > 0)
      .join('\n')
  }
  if (isObject(value)) {
    return typeof value.text === 'string' ? value.text : ''
  }
  return ''
}

function extractTextFromItem(item: unknown): string {
  if (typeof item === 'string') return item
  if (!isObject(item)) return ''
  if (item.type === 'tool_use') {
    const name = typeof item.name === 'string' && item.name.length > 0 ? item.name : 'unknown'
    return `[Tool: ${name}]`
  }
  if (item.type === 'tool_result') {
    return extractText(item.content)
  }
  if (typeof item.text === 'string') return item.text
  if (typeof item.input_text === 'string') return item.input_text
  if (typeof item.output_text === 'string') return item.output_text
  if (item.content !== undefined) return extractText(item.content)
  return ''
}

/** 按 code point 截断；超长追加字面量 '...'；纯空白 → ''。 */
export function truncateSummary(text: string, maxChars: number): string {
  const trimmed = text.trim()
  if (trimmed.length === 0) return ''
  const chars = Array.from(trimmed)
  if (chars.length <= maxChars) return trimmed
  return chars.slice(0, maxChars).join('') + '...'
}

/** 取路径末段（兼容 / 和 \\），去尾部分隔符。 */
export function pathBasename(value: string): string {
  const trimmed = value.trim().replace(/[/\\]+$/, '')
  if (trimmed.length === 0) return ''
  const parts = trimmed.split(/[/\\]/)
  return parts[parts.length - 1] ?? ''
}

/** 仅放行安全 id 字符（防止后续拼进 shell 命令时注入）。 */
export function sanitizeSessionId(raw: string): string {
  const out = Array.from(raw.trim())
    .filter((ch) => /[A-Za-z0-9._-]/.test(ch))
    .join('')
  // 拒绝不含任何字母数字的结果（如 '..' / '.' / '--'），防止后续删除 sidecar 时指向父目录。
  return /[A-Za-z0-9]/.test(out) ? out : ''
}

/** 统一 title 派生：自定义标题 > 首条真实 user 消息 > 目录名 > sessionId（前两者截断 80）。 */
export function deriveTitle(opts: {
  customTitle?: string | undefined
  firstUserText?: string | undefined
  projectDir?: string | undefined
  sessionId: string
}): string {
  const custom = opts.customTitle?.trim()
  if (custom) return truncateSummary(custom, TITLE_MAX_CHARS)
  const firstUser = opts.firstUserText?.trim()
  if (firstUser) return truncateSummary(firstUser, TITLE_MAX_CHARS)
  const base = opts.projectDir ? pathBasename(opts.projectDir) : ''
  if (base) return base
  return opts.sessionId
}
