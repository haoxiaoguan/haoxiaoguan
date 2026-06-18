// 第三方中转「出站」镜像转换器：Canonical IR ↔ OpenAI Chat Completions（上游方向）。
// inbound/openai.ts 是「客户端线协议 ↔ IR」入站对;本文件是其镜像「IR ↔ 上游线协议」出站对:
//   - irToOpenAIChatRequest:  IR → 上游请求体(RelayAdapter 发给第三方时用)
//   - openAIChatResponseToIR: 上游非流式 JSON → CanonicalResponse
//   - createOpenAiSseToEventsParser: 上游 SSE(增量、半帧)→ CanonicalStreamEvent[]
// 平台无关、确定性纯函数:不读时钟/随机(对齐 inbound 不变量)。bytecode 安全:闭包工厂 + 对象方法,无 class 字段箭头。
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalStreamEvent,
  ContentBlock,
  StopReason,
  Usage,
} from '../../../domain/canonical'
import type {
  OpenAIChatRequest,
  OpenAIMessage,
  OpenAIContentPart,
  OpenAIToolCall,
  OpenAITool,
  OpenAIToolChoice,
  OpenAIChatCompletion,
  OpenAIUsage,
} from '../../inbound/openai'

/** 出站请求体:OpenAIChatRequest + stream_options(让上游流式回传 usage)。 */
export interface OpenAIChatRequestOut extends OpenAIChatRequest {
  stream_options?: { include_usage: boolean }
}

// ============ 共享小工具 ============

/** OpenAI finish_reason → IR StopReason(openai.ts stopReasonToOpenAI 的逆)。 */
function finishReasonToIR(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'length':
      return 'max_tokens'
    case 'tool_calls':
      return 'tool_use'
    default:
      return 'end_turn'
  }
}

/**
 * OpenAI usage → IR Usage。
 * OpenAI 的 prompt_tokens 是「总输入（含命中缓存）」；IR 约定 inputTokens 为「非缓存新增输入」，
 * 故扣去 cached_tokens 单列到 cacheReadTokens，保证各上游进 IR 后 inputTokens 口径一致。
 */
function usageFromOpenAI(u: OpenAIUsage | undefined): Usage {
  const prompt = u?.prompt_tokens ?? 0
  const cached = u?.prompt_tokens_details?.cached_tokens
  const usage: Usage = {
    inputTokens: typeof cached === 'number' ? Math.max(prompt - cached, 0) : prompt,
    outputTokens: u?.completion_tokens ?? 0,
  }
  if (typeof cached === 'number') usage.cacheReadTokens = cached
  return usage
}

/** 容错解析 tool 调用 arguments(JSON 字符串 → 对象;失败回退 {})。 */
function parseToolArgs(args: string | undefined): Record<string, unknown> {
  try {
    const parsed = JSON.parse(args || '{}')
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // 模型偶发非法 JSON：按空对象处理而非整请求失败。
  }
  return {}
}

// ============ IR → OpenAI 请求体 ============

/** 把 IR ToolResultBlock 渲染成 OpenAI 独立 role:'tool' 消息(content 收敛为文本)。 */
function renderToolResultMessage(block: Extract<ContentBlock, { type: 'tool_result' }>): OpenAIMessage {
  const text = block.content
    .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
    .map((b) => b.text)
    .join('')
  return { role: 'tool', tool_call_id: block.toolUseId, content: text }
}

/** 把 IR assistant 消息渲染成 OpenAI assistant 消息(text→content,tool_use→tool_calls;thinking/image 丢弃)。 */
function renderAssistantMessage(msg: CanonicalMessage): OpenAIMessage {
  let text = ''
  const toolCalls: OpenAIToolCall[] = []
  for (const b of msg.content) {
    if (b.type === 'text') {
      text += b.text
    } else if (b.type === 'tool_use') {
      toolCalls.push({ id: b.id, type: 'function', function: { name: b.name, arguments: JSON.stringify(b.input) } })
    }
    // thinking/image 在 OpenAI assistant 无承载,丢弃。
  }
  const out: OpenAIMessage = {
    role: 'assistant',
    content: toolCalls.length > 0 ? (text.length > 0 ? text : null) : text,
  }
  if (toolCalls.length > 0) out.tool_calls = toolCalls
  return out
}

/** 把 IR user 消息的 text/image 块渲染成 OpenAI user content(纯文本则收敛为字符串,含图片则用 parts)。 */
function renderUserContent(parts: OpenAIContentPart[]): string | OpenAIContentPart[] {
  const hasImage = parts.some((p) => p.type === 'image_url')
  if (!hasImage) {
    return parts
      .filter((p) => p.type === 'text')
      .map((p) => p.text ?? '')
      .join('')
  }
  return parts
}

function mapToolsOut(ir: CanonicalRequest): OpenAITool[] | undefined {
  if (!ir.tools || ir.tools.length === 0) return undefined
  return ir.tools.map((t) => ({
    type: 'function',
    function: {
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      parameters: t.inputSchema,
    },
  }))
}

function mapToolChoiceOut(ir: CanonicalRequest): OpenAIToolChoice | undefined {
  const tc = ir.toolChoice
  if (tc === undefined) return undefined
  switch (tc.type) {
    case 'auto':
      return 'auto'
    case 'none':
      return 'none'
    case 'any':
      return 'required'
    case 'tool':
      return { type: 'function', function: { name: tc.name } }
  }
}

/**
 * CanonicalRequest → OpenAI Chat Completions 请求体（openaiToIR 的逆）。
 * - ir.system → 首条 system 消息。
 * - user 消息内的 tool_result 块拆回独立 role:'tool' 消息(置于该 user 之前),text/image 渲染为 user 消息。
 * - assistant 的 text→content、tool_use→tool_calls。
 * - stream=true 时附 stream_options.include_usage,确保上游流式回传 usage(否则用量为 0)。
 */
export function irToOpenAIChatRequest(ir: CanonicalRequest): OpenAIChatRequestOut {
  const messages: OpenAIMessage[] = []
  if (ir.system !== undefined && ir.system.length > 0) {
    messages.push({ role: 'system', content: ir.system })
  }

  for (const msg of ir.messages) {
    if (msg.role === 'assistant') {
      messages.push(renderAssistantMessage(msg))
      continue
    }
    // user:tool_result 块 → 独立 tool 消息(先排);text/image → user 消息(后排)。
    const toolMsgs: OpenAIMessage[] = []
    const userParts: OpenAIContentPart[] = []
    for (const b of msg.content) {
      if (b.type === 'tool_result') {
        toolMsgs.push(renderToolResultMessage(b))
      } else if (b.type === 'text') {
        userParts.push({ type: 'text', text: b.text })
      } else if (b.type === 'image') {
        userParts.push({ type: 'image_url', image_url: { url: `data:${b.mediaType};base64,${b.data}` } })
      }
    }
    for (const tm of toolMsgs) messages.push(tm)
    if (userParts.length > 0) messages.push({ role: 'user', content: renderUserContent(userParts) })
  }

  const out: OpenAIChatRequestOut = { model: ir.model, messages }
  if (ir.maxTokens !== undefined) out.max_tokens = ir.maxTokens
  if (ir.temperature !== undefined) out.temperature = ir.temperature
  if (ir.topP !== undefined) out.top_p = ir.topP
  const tools = mapToolsOut(ir)
  if (tools) out.tools = tools
  const toolChoice = mapToolChoiceOut(ir)
  if (toolChoice !== undefined) out.tool_choice = toolChoice
  if (ir.metadata !== undefined) out.metadata = ir.metadata
  out.stream = ir.stream
  if (ir.stream) out.stream_options = { include_usage: true }
  return out
}

// ============ OpenAI 非流式响应 → IR ============

/** OpenAI 上游可能带的 reasoning_content(DeepSeek/兼容实现);用 unknown 安全读取。 */
function readReasoning(message: unknown): string | undefined {
  if (message !== null && typeof message === 'object' && 'reasoning_content' in message) {
    const r = (message as { reasoning_content?: unknown }).reasoning_content
    if (typeof r === 'string' && r.length > 0) return r
  }
  return undefined
}

/**
 * OpenAI chat.completion → CanonicalResponse（irToOpenAIResponse 的逆）。
 * reasoning_content(若上游有)→ ThinkingBlock;content→TextBlock;tool_calls→ToolUseBlock。usage 取上游真实值。
 */
export function openAIChatResponseToIR(resp: OpenAIChatCompletion): CanonicalResponse {
  const choice = resp.choices?.[0]
  const message = choice?.message
  const content: ContentBlock[] = []

  const reasoning = readReasoning(message)
  if (reasoning !== undefined) content.push({ type: 'thinking', text: reasoning })
  if (typeof message?.content === 'string' && message.content.length > 0) {
    content.push({ type: 'text', text: message.content })
  }
  if (message?.tool_calls) {
    for (const tc of message.tool_calls) {
      content.push({ type: 'tool_use', id: tc.id, name: tc.function.name, input: parseToolArgs(tc.function.arguments) })
    }
  }

  return {
    model: resp.model,
    content,
    stopReason: finishReasonToIR(choice?.finish_reason),
    usage: usageFromOpenAI(resp.usage),
  }
}

// ============ OpenAI SSE → IR 事件(增量状态机) ============

interface StreamToolCallDelta {
  index?: number
  id?: string
  function?: { name?: string; arguments?: string }
}
interface StreamChoiceDelta {
  content?: string
  reasoning_content?: string
  tool_calls?: StreamToolCallDelta[]
}
interface StreamChunk {
  choices?: { delta?: StreamChoiceDelta; finish_reason?: string | null }[]
  usage?: OpenAIUsage
}

/** 增量 SSE 解析器:push 喂入字节文本(可半帧),返回本次解出的 IR 事件;flush 收尾。 */
export interface OpenAiSseParser {
  push(textChunk: string): CanonicalStreamEvent[]
  flush(): CanonicalStreamEvent[]
}

/**
 * 创建 OpenAI Chat SSE → IR 事件流的增量解析器。
 * 处理:半帧缓冲(按 \n 切行)、`data: {json}` / `data: [DONE]`、delta.content→text_delta、
 * delta.reasoning_content→thinking_delta、tool_calls 分片(首见 index 带 id/name → tool_use_start,
 * arguments 片段 → tool_use_delta)、finish_reason→message_stop、usage→usage。畸形帧跳过,不中断。
 */
export function createOpenAiSseToEventsParser(): OpenAiSseParser {
  let buffer = ''
  let done = false
  const seenTools = new Set<number>()

  function processDataLine(line: string): CanonicalStreamEvent[] {
    const events: CanonicalStreamEvent[] = []
    const trimmed = line.replace(/\r$/, '').trimStart()
    if (!trimmed.startsWith('data:')) return events // 忽略 event:/注释/空行
    const data = trimmed.slice('data:'.length).trim()
    if (data === '') return events
    if (data === '[DONE]') {
      done = true
      return events
    }
    let chunk: StreamChunk
    try {
      chunk = JSON.parse(data) as StreamChunk
    } catch {
      return events // 畸形 JSON 跳过
    }
    const choice = chunk.choices?.[0]
    const delta = choice?.delta
    if (delta) {
      if (typeof delta.content === 'string' && delta.content.length > 0) {
        events.push({ type: 'text_delta', text: delta.content })
      }
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) {
        events.push({ type: 'thinking_delta', text: delta.reasoning_content })
      }
      if (Array.isArray(delta.tool_calls)) {
        for (const tc of delta.tool_calls) {
          const index = typeof tc.index === 'number' ? tc.index : 0
          if (!seenTools.has(index)) {
            const name = tc.function?.name
            if (tc.id !== undefined || (name !== undefined && name.length > 0)) {
              seenTools.add(index)
              events.push({ type: 'tool_use_start', index, id: tc.id ?? '', name: name ?? '' })
            }
          }
          const args = tc.function?.arguments
          if (typeof args === 'string' && args.length > 0) {
            events.push({ type: 'tool_use_delta', index, partialJson: args })
          }
        }
      }
    }
    if (choice && choice.finish_reason != null) {
      events.push({ type: 'message_stop', stopReason: finishReasonToIR(choice.finish_reason) })
    }
    if (chunk.usage) {
      events.push({ type: 'usage', usage: usageFromOpenAI(chunk.usage) })
    }
    return events
  }

  return {
    push(textChunk: string): CanonicalStreamEvent[] {
      if (done) return []
      buffer += textChunk
      const events: CanonicalStreamEvent[] = []
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        for (const ev of processDataLine(line)) events.push(ev)
        if (done) {
          buffer = ''
          return events
        }
        nl = buffer.indexOf('\n')
      }
      return events
    },
    flush(): CanonicalStreamEvent[] {
      if (done || buffer.trim() === '') {
        buffer = ''
        return []
      }
      const events = processDataLine(buffer)
      buffer = ''
      return events
    },
  }
}

/** 便捷:把完整 SSE 文本一次性解析成 IR 事件序列(测试/非流式场景用)。 */
export function parseOpenAiSse(fullSseText: string): CanonicalStreamEvent[] {
  const parser = createOpenAiSseToEventsParser()
  return [...parser.push(fullSseText), ...parser.flush()]
}
