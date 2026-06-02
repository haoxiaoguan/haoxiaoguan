// 规范 IR 桶导出。转换器与适配器一律从 '../../domain/canonical' import IR 类型，
// 不直接引用各分文件，便于后续重构内部布局。
export type {
  TextBlock,
  ImageBlock,
  ToolUseBlock,
  ToolResultBlock,
  ToolResultContent,
  ThinkingBlock,
  ContentBlock,
} from './content-block'

export type {
  CanonicalMessage,
  ToolDef,
  ToolChoice,
  ThinkingConfig,
  CanonicalRequest,
} from './canonical-request'

export type { StopReason, Usage, CanonicalResponse } from './canonical-response'

export type {
  TextDeltaEvent,
  ThinkingDeltaEvent,
  ToolUseStartEvent,
  ToolUseDeltaEvent,
  MessageStopEvent,
  UsageEvent,
  CanonicalStreamEvent,
} from './canonical-stream'
