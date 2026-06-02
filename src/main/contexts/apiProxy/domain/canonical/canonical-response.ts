// 规范 IR —— 响应侧类型：StopReason / Usage / CanonicalResponse。
import type { ContentBlock } from './content-block'

/** 停止原因（中立四值枚举）。各协议出站时各自翻译到其线格式。 */
export type StopReason = 'end_turn' | 'max_tokens' | 'tool_use' | 'stop_sequence'

/** token 用量。inputTokens/outputTokens 必填；缓存读写可选。 */
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
