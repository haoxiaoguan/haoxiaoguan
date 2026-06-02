// Kiro thinking 注入（纯函数）。CodeWhisperer 无独立 system 槽，extended thinking 靠两条通道：
//   1) 系统提示标签注入：<thinking_mode>enabled</thinking_mode> + <max_thinking_length>，塞进 current message content 前缀。
//   2) 模型请求字段：additionalModelRequestFields.thinking = { type:'enabled', budget_tokens }。
// 另提供把上游误混进正文的 <thinking>…</thinking> 文本解析回 thinking 块的辅助（供 M3b 上游解析用）。
import type { ThinkingConfig } from '../../../domain/canonical'

export const DEFAULT_MAX_THINKING_LENGTH = 200000
export const MIN_THINKING_BUDGET = 1024

// 把预算钳制进 [MIN_THINKING_BUDGET, DEFAULT_MAX_THINKING_LENGTH]。
function clampBudget(budget: number | undefined): number {
  const b = budget ?? DEFAULT_MAX_THINKING_LENGTH
  if (b < MIN_THINKING_BUDGET) return MIN_THINKING_BUDGET
  if (b > DEFAULT_MAX_THINKING_LENGTH) return DEFAULT_MAX_THINKING_LENGTH
  return b
}

/**
 * 生成 thinking 系统提示前缀。enabled → 两行标签（含钳制后的 max_thinking_length）；
 * disabled/缺省 → 空串（不注入）。
 */
export function buildThinkingPrefix(thinking: ThinkingConfig | undefined): string {
  if (thinking === undefined || thinking.type !== 'enabled') return ''
  const budget = clampBudget(thinking.budgetTokens)
  return `<thinking_mode>enabled</thinking_mode>\n<max_thinking_length>${budget}</max_thinking_length>`
}

/**
 * 把 thinking 前缀织入 system 字符串。
 * 前缀为空 → 原样返回 system（含 undefined）；非空 + 有 system → `${prefix}\n\n${system}`；非空 + 无 system → prefix。
 */
export function injectThinkingIntoSystem(
  system: string | undefined,
  thinking: ThinkingConfig | undefined,
): string | undefined {
  const prefix = buildThinkingPrefix(thinking)
  if (prefix.length === 0) return system
  return system !== undefined ? `${prefix}\n\n${system}` : prefix
}

/**
 * 产出 additionalModelRequestFields.thinking（模型请求字段通道）。
 * enabled → { thinking: { type:'enabled', budget_tokens: <clamp> } }；否则 undefined。
 */
export function buildAdditionalModelRequestFields(
  thinking: ThinkingConfig | undefined,
): Record<string, unknown> | undefined {
  if (thinking === undefined || thinking.type !== 'enabled') return undefined
  return { thinking: { type: 'enabled', budget_tokens: clampBudget(thinking.budgetTokens) } }
}

// 匹配最外层 <thinking>...</thinking>（DOTALL：[\s\S] 跨行；非贪婪取首个闭合）。
const THINKING_TAG_RE = /<thinking>([\s\S]*?)<\/thinking>/

/**
 * 从文本里抽出最外层 <thinking>…</thinking> 作为 thinking，剩余作为 text（trim 边界空白）。
 * 无标签 → { text }（原样）。供 M3b 在上游把 thinking 误混进正文时回收。
 */
export function parseThinkingTags(text: string): { thinking?: string; text: string } {
  const match = THINKING_TAG_RE.exec(text)
  if (match === null) return { text }
  const thinking = match[1].trim()
  const remainder = (text.slice(0, match.index) + text.slice(match.index + match[0].length)).trim()
  return { thinking, text: remainder }
}
