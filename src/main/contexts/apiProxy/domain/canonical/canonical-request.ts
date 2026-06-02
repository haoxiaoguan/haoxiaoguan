// 规范 IR —— 请求侧类型：CanonicalRequest / CanonicalMessage / ToolDef / ToolChoice / ThinkingConfig。
import type { ContentBlock } from './content-block'

/** 一条规范消息。role 仅二元；content 永远是数组（字符串入站时归一化为单个 TextBlock）。 */
export interface CanonicalMessage {
  role: 'user' | 'assistant'
  content: ContentBlock[]
}

/** 工具声明。inputSchema 为 JSON Schema 对象（各协议字段名不同，入站统一到此）。 */
export interface ToolDef {
  name: string
  description?: string
  inputSchema: Record<string, unknown>
}

/**
 * 工具选择策略。
 * - auto：模型自行决定是否调用工具
 * - any：必须调用某个工具
 * - none：禁止调用工具
 * - tool：强制调用指定名字的工具
 */
export type ToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string }

/** 思考配置。enabled 可带 token 预算；disabled 显式关闭。 */
export type ThinkingConfig =
  | { type: 'enabled'; budgetTokens?: number }
  | { type: 'disabled' }

/** prompt cache 断点输入（旁路元信息，仅 Anthropic 入站填充；其余协议留空）。 */
export interface CacheBreakpointInput {
  value: string
  tokens: number
  ttl: number
  isMessageEnd: boolean
}

/**
 * 规范请求 —— 入站三协议归一化的统一目标，也是平台适配器的输入（M2b+）。
 * system 收敛为单一字符串（多段以 '\n' 连接）；stream 必填（入站缺省 false）。
 * cacheControl 为旁路元信息：仅 Anthropic 入站在出现 cache_control 时填充，供下游缓存计费模拟使用。
 */
export interface CanonicalRequest {
  model: string
  system?: string
  messages: CanonicalMessage[]
  tools?: ToolDef[]
  toolChoice?: ToolChoice
  maxTokens?: number
  temperature?: number
  topP?: number
  stream: boolean
  thinking?: ThinkingConfig
  metadata?: Record<string, unknown>
  cacheControl?: CacheBreakpointInput[]
}
