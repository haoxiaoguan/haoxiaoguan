// 规范 IR —— 响应侧类型：StopReason / Usage / CanonicalResponse。
import type { ContentBlock } from './content-block'

/** 停止原因（中立四值枚举）。各协议出站时各自翻译到其线格式。 */
export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'

/**
 * token 用量（统一口径）。
 * - inputTokens：**非缓存的新增输入** token（不含 cache 读/写）。各上游适配器入站解析时统一按此口径填充
 *   （Anthropic input_tokens 天然不含 cache；OpenAI prompt_tokens / Gemini promptTokenCount 含 cache，
 *   入站时已扣去 cached 单列）。
 * - cacheReadTokens：命中缓存读取的输入 token；cacheWriteTokens：写入缓存的输入 token。均可选。
 * 出站到 responses/openai/gemini 等「总输入」语义协议时，由序列化层补回缓存：
 *   总输入 = inputTokens + cacheReadTokens + cacheWriteTokens，cached 仅取 cacheReadTokens。
 * Anthropic 出站则直接用 inputTokens 作 input_tokens、cache 读写单列（无需补回）。
 */
export interface Usage {
  inputTokens: number
  outputTokens: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
}

/**
 * 规范（非流式）响应 —— 平台适配器 chat() 的产出（M2b+），也是入站层 irToXxxResponse 的输入。
 * content 与请求复用同一套 ContentBlock；响应侧通常是 text / thinking / tool_use。
 */
export interface CanonicalResponse {
  model: string
  content: ContentBlock[]
  stopReason: StopReason
  usage: Usage
}
