// IR → AWS CodeWhisperer conversationState 构建（纯函数）。
// 把 CanonicalRequest 转成 ConversationStateEnvelope：currentMessage（含 system/thinking 前缀 + tools + toolResults + images）
// + 清洗后的 history + inferenceConfig + additionalModelRequestFields。
// 所有指纹/路由信息由 opts 注入；本层不读凭据/时钟/随机。
// buildKiroPayload（按 Kiro 线协议实现，不含 token 估算/缓存/网络）。
import type {
  CanonicalRequest,
  CanonicalMessage,
  ContentBlock,
  ToolDef,
} from '../../../domain/canonical'
import type {
  ConversationStateEnvelope,
  BuildConversationStateOpts,
  KiroUserInputMessage,
  KiroUserInputMessageContext,
  KiroTool,
  KiroToolResult,
  KiroImage,
  KiroImageFormat,
  KiroInferenceConfig,
  KiroHistoryMessage,
} from './kiro-wire-types'
import {
  irMessagesToKiroHistory,
  normalizeToolHistory,
  sanitizeConversation,
  truncateToolResultText,
} from './kiro-conversation'
import {
  injectThinkingIntoSystem,
  buildAdditionalModelRequestFields,
} from './kiro-thinking'

const DEFAULT_TOOL_RESULT_MAX_BYTES = 1_572_864 // 1.5MB

// IR mediaType（'image/png'）→ Kiro 短名（'png'）。未知一律按 'png'（CodeWhisperer 接受度最高）。
function toKiroImageFormat(mediaType: string): KiroImageFormat {
  const sub = mediaType.toLowerCase().split('/')[1] ?? ''
  if (sub === 'jpeg' || sub === 'jpg') return 'jpeg'
  if (sub === 'gif') return 'gif'
  if (sub === 'webp') return 'webp'
  return 'png'
}

// 把一条 IR 消息的 text 块拼成单字符串（'\n' 连接）。
function joinText(content: ContentBlock[]): string {
  return content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
}

// 取 IR 消息里的 image 块 → Kiro images。
function extractImages(content: ContentBlock[]): KiroImage[] {
  const out: KiroImage[] = []
  for (const b of content) {
    if (b.type === 'image') out.push({ format: toKiroImageFormat(b.mediaType), source: { bytes: b.data } })
  }
  return out
}

// 取 IR 消息里的 tool_result 块 → Kiro toolResults（content 非空，空则填一个空格以满足 Kiro 非空要求）。
// Kiro（CodeWhisperer）toolResult.content 仅支持 text，不接受 image 块（上游格式限制）。
// image 块不直接丢弃，而是替换为 "[image]" 占位文本，保留"这里有图"的语义信息。
function extractToolResults(content: ContentBlock[]): KiroToolResult[] {
  const out: KiroToolResult[] = []
  for (const b of content) {
    if (b.type !== 'tool_result') continue
    const parts: string[] = []
    for (const c of b.content) {
      if (c.type === 'text') {
        parts.push(c.text)
      } else if (c.type === 'image') {
        // image 块在 Kiro toolResult 中不支持，转为占位文本以避免语义丢失。
        parts.push('[image]')
      }
      // 其它类型忽略。
    }
    const text = parts.join('\n')
    out.push({
      toolUseId: b.toolUseId,
      content: [{ text: text.length > 0 ? text : ' ' }],
      status: b.isError === true ? 'error' : 'success',
    })
  }
  return out
}

// IR ToolDef[] → Kiro tools（挂当前消息）。
function mapTools(tools: ToolDef[] | undefined): KiroTool[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    toolSpecification: {
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      inputSchema: { json: t.inputSchema ?? {} },
    },
  }))
}

// 由 IR maxTokens/temperature/topP 组 inferenceConfig（任一存在才返回）。
function buildInferenceConfig(ir: CanonicalRequest): KiroInferenceConfig | undefined {
  const cfg: KiroInferenceConfig = {}
  if (ir.maxTokens !== undefined) cfg.maxTokens = ir.maxTokens
  if (ir.temperature !== undefined) cfg.temperature = ir.temperature
  if (ir.topP !== undefined) cfg.topP = ir.topP
  return Object.keys(cfg).length > 0 ? cfg : undefined
}

/**
 * 构建当前消息的 userInputMessage：
 * - content = injectThinkingIntoSystem(system, thinking) 前缀 + 最后一条 user 文本。
 *   空文本且有 toolResults → 留 ''（Kiro 允许带 toolResults 的空 content）；空且无 toolResults → 'Continue' 兜底。
 * - images / toolResults（来自最后一条 user 消息）/ tools（来自请求级 ir.tools）挂 userInputMessageContext。
 */
function buildCurrentMessage(
  ir: CanonicalRequest,
  lastUser: CanonicalMessage | undefined,
  opts: BuildConversationStateOpts,
): KiroUserInputMessage {
  const userText = lastUser ? joinText(lastUser.content) : ''
  const images = lastUser ? extractImages(lastUser.content) : []
  const toolResults = lastUser ? extractToolResults(lastUser.content) : []
  const tools = mapTools(ir.tools)

  const withSystem = injectThinkingIntoSystem(ir.system, ir.thinking)
  // 先拼 system/thinking 前缀，再决定空兜底。
  let content: string
  if (userText.length > 0) {
    content = withSystem !== undefined ? `${withSystem}\n\n${userText}` : userText
  } else if (toolResults.length > 0) {
    content = withSystem !== undefined ? withSystem : ''
  } else {
    content = withSystem !== undefined ? `${withSystem}\n\nContinue` : 'Continue'
  }

  const ctx: KiroUserInputMessageContext = {}
  if (tools !== undefined) ctx.tools = tools
  if (toolResults.length > 0) ctx.toolResults = toolResults

  const msg: KiroUserInputMessage = {
    content,
    modelId: opts.modelId,
    origin: opts.origin,
  }
  if (images.length > 0) msg.images = images
  if (Object.keys(ctx).length > 0) msg.userInputMessageContext = ctx
  return msg
}

/**
 * IR → CodeWhisperer conversationState 信封。
 * 步骤：拆 history(除最后一条 user)/当前(最后一条 user) → irMessagesToKiroHistory(history) → sanitizeConversation
 *      → truncateToolResultText → 组 currentMessage（system/thinking 前缀 + tools/toolResults/images）→ 组顶层字段。
 */
export function buildConversationState(
  ir: CanonicalRequest,
  opts: BuildConversationStateOpts,
): ConversationStateEnvelope {
  const maxBytes = opts.toolResultMaxBytes ?? DEFAULT_TOOL_RESULT_MAX_BYTES

  // 找最后一条 user 消息作为「当前消息」；其余作为 history 源。
  let lastUserIdx = -1
  for (let i = ir.messages.length - 1; i >= 0; i--) {
    if (ir.messages[i].role === 'user') {
      lastUserIdx = i
      break
    }
  }
  const lastUser = lastUserIdx >= 0 ? ir.messages[lastUserIdx] : undefined
  const historySource =
    lastUserIdx >= 0 ? ir.messages.slice(0, lastUserIdx) : ir.messages.slice()

  // history：IR → Kiro → 未声明工具拍平 → 清洗（user 起止/交替/toolUse 配对）→ 字节截断。
  // declaredNames = 当前请求声明的工具集；history 引用其外的结构化 toolUse 会被拍平成文本（否则 CodeWhisperer 400）。
  const declaredNames = new Set<string>((ir.tools ?? []).map((t) => t.name))
  let history: KiroHistoryMessage[] = irMessagesToKiroHistory(historySource)
  if (history.length > 0) {
    history = normalizeToolHistory(history, declaredNames)
    history = sanitizeConversation(history)
    history = truncateToolResultText(history, maxBytes)
  }

  const currentMessage = buildCurrentMessage(ir, lastUser, opts)

  const envelope: ConversationStateEnvelope = {
    conversationState: {
      chatTriggerType: 'MANUAL',
      conversationId: opts.conversationId,
      ...(opts.agentContinuationId !== undefined ? { agentContinuationId: opts.agentContinuationId } : {}),
      agentTaskType: 'vibe',
      currentMessage: { userInputMessage: currentMessage },
      ...(history.length > 0 ? { history } : {}),
    },
  }

  if (opts.profileArn !== undefined) envelope.profileArn = opts.profileArn
  const inferenceConfig = buildInferenceConfig(ir)
  if (inferenceConfig !== undefined) envelope.inferenceConfig = inferenceConfig
  const amrf = buildAdditionalModelRequestFields(ir.thinking)
  if (amrf !== undefined) envelope.additionalModelRequestFields = amrf

  return envelope
}
