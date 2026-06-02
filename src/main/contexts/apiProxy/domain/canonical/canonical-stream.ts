// 规范 IR —— 流式事件联合 CanonicalStreamEvent。
// 平台适配器 chatStream() 产出此事件流（M2b+）；入站层 serializeXxxStream 把它翻成各协议 wire 帧。
// 以字面量 `type` 判别。
import type { StopReason } from './canonical-response'
import type { Usage } from './canonical-response'

/** 文本增量。 */
export interface TextDeltaEvent {
  type: 'text_delta'
  text: string
}

/** 思考增量（extended thinking 的流式片段）。 */
export interface ThinkingDeltaEvent {
  type: 'thinking_delta'
  text: string
}

/** 工具调用开始：宣告一个新的 tool_use（带稳定 index 供出站帧对齐）。 */
export interface ToolUseStartEvent {
  type: 'tool_use_start'
  index: number
  id: string
  name: string
}

/** 工具调用入参增量：以 JSON 片段累积（与 Anthropic input_json_delta 对齐）。 */
export interface ToolUseDeltaEvent {
  type: 'tool_use_delta'
  index: number
  partialJson: string
}

/** 消息结束：携带最终停止原因。 */
export interface MessageStopEvent {
  type: 'message_stop'
  stopReason: StopReason
}

/** 用量事件：流式收尾时给出 token 统计。 */
export interface UsageEvent {
  type: 'usage'
  usage: Usage
}

/** 流式事件联合。 */
export type CanonicalStreamEvent =
  | TextDeltaEvent
  | ThinkingDeltaEvent
  | ToolUseStartEvent
  | ToolUseDeltaEvent
  | MessageStopEvent
  | UsageEvent
