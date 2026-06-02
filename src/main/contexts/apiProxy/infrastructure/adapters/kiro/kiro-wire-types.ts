// AWS CodeWhisperer（Kiro 上游）线格式 TS 类型。M3a 多个 kiro 模块共享。
// 参考：参考实现 线协议模块 的 KiroPayload / KiroUserInputMessage / KiroHistoryMessage 等
// （按线协议重写，剔除 cachePoint/documents/editorState 等本里程碑不用的字段）。

/** Kiro 图片格式（与 CodeWhisperer 取值一致；IR mediaType 'image/png' 等映射到此短名）。 */
export type KiroImageFormat = 'png' | 'jpeg' | 'gif' | 'webp'

/** Kiro 图片块：source.bytes 为 base64 裸串（不含 data URL 前缀）。 */
export interface KiroImage {
  format: KiroImageFormat
  source: { bytes: string }
}

/** Kiro toolResult.content 元素（M3a 只产出 text 形态）。 */
export interface KiroToolResultContent {
  text?: string
  json?: unknown
}

/** Kiro 工具结果。status 仅 success/error。 */
export interface KiroToolResult {
  toolUseId: string
  content: KiroToolResultContent[]
  status: 'success' | 'error'
}

/** Kiro 工具调用（assistant 侧 history 内）。input 为已解析对象。 */
export interface KiroToolUse {
  toolUseId: string
  name: string
  input: unknown
}

/** Kiro 工具声明（挂当前消息 userInputMessageContext.tools）。inputSchema.json 为 JSON Schema。 */
export interface KiroToolSpecification {
  name: string
  description?: string
  inputSchema: { json: Record<string, unknown> }
}

export interface KiroTool {
  toolSpecification: KiroToolSpecification
}

export interface KiroUserInputMessageContext {
  tools?: KiroTool[]
  toolResults?: KiroToolResult[]
}

export interface KiroUserInputMessage {
  content: string
  modelId?: string
  origin?: string
  images?: KiroImage[]
  userInputMessageContext?: KiroUserInputMessageContext
}

export interface KiroAssistantResponseMessage {
  content: string
  toolUses?: KiroToolUse[]
}

/** history 元素：二选一（user 或 assistant）。 */
export interface KiroHistoryMessage {
  userInputMessage?: KiroUserInputMessage
  assistantResponseMessage?: KiroAssistantResponseMessage
}

export interface KiroInferenceConfig {
  maxTokens?: number
  temperature?: number
  topP?: number
}

export interface KiroConversationState {
  chatTriggerType: 'MANUAL'
  conversationId: string
  agentContinuationId?: string
  agentTaskType?: 'vibe'
  currentMessage: { userInputMessage: KiroUserInputMessage }
  history?: KiroHistoryMessage[]
}

/** buildConversationState 的产出：conversationState + 顶层并列字段。 */
export interface ConversationStateEnvelope {
  conversationState: KiroConversationState
  profileArn?: string
  inferenceConfig?: KiroInferenceConfig
  additionalModelRequestFields?: Record<string, unknown>
}

/** buildConversationState 的注入项。所有指纹/路由信息由调用方（M3b）给定——本层不读凭据/时钟/随机。 */
export interface BuildConversationStateOpts {
  /** 已经过 mapModelId 的模型 ID（调用方负责映射）。 */
  modelId: string
  /** 'AI_EDITOR'（IDE 模式）；由调用方注入。 */
  origin: string
  /** 稳定会话 id（M3b 从 sessionHint/uuid 注入；测试直接给）。 */
  conversationId: string
  /** agent 续传 id（注入则写入 conversationState；缺省则不写）。 */
  agentContinuationId?: string
  /** 凭据解析出的 profileArn（注入则写顶层）。 */
  profileArn?: string
  /** 单条 toolResult 文本字节上限（默认 1.5MB）。 */
  toolResultMaxBytes?: number
}
