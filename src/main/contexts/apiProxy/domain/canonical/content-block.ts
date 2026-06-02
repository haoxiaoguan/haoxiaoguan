// 规范 IR（Canonical Chat IR）—— ContentBlock 联合。
// 中立的内部内容块表达，借鉴 Anthropic Messages 的 block 模型，但不绑定任何上游协议。
// 所有块以字面量 `type` 字段判别；入站转换器把各协议内容收敛到这套块，
// 出站转换器从这套块还原各协议内容。

/** 纯文本块。 */
export interface TextBlock {
  type: 'text'
  text: string
}

/**
 * 图片块。data 为 base64 裸串（**不含** `data:<mime>;base64,` 前缀），
 * mediaType 形如 'image/png'。入站时剥离 data URL 前缀，出站时按目标协议重新拼装。
 */
export interface ImageBlock {
  type: 'image'
  mediaType: string
  data: string
}

/**
 * 工具调用块（assistant 发起）。input 是**已解析的对象**；
 * OpenAI 的 arguments(JSON 字符串) 入站时 JSON.parse 成对象，出站时再 stringify。
 */
export interface ToolUseBlock {
  type: 'tool_use'
  id: string
  name: string
  input: Record<string, unknown>
}

/** 工具结果块内允许的内容：仅 text / image（与 Anthropic tool_result 一致）。 */
export type ToolResultContent = TextBlock | ImageBlock

/**
 * 工具结果块（user 侧回填）。toolUseId 关联对应的 ToolUseBlock.id。
 * content 为结构化结果（多为单个 text）；isError 标记工具执行失败。
 */
export interface ToolResultBlock {
  type: 'tool_result'
  toolUseId: string
  content: ToolResultContent[]
  isError?: boolean
}

/** 思考块（extended thinking）。signature 为可选的加密签名（Anthropic 透传）。 */
export interface ThinkingBlock {
  type: 'thinking'
  text: string
  signature?: string
}

/** 内容块联合：所有 IR 消息/响应的 content 元素。 */
export type ContentBlock =
  | TextBlock
  | ImageBlock
  | ToolUseBlock
  | ToolResultBlock
  | ThinkingBlock
