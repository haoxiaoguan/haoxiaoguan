// 入站转换器：OpenAI Chat Completions ↔ 规范 IR。
// 请求方向 openaiToIR；响应/流方向 irToOpenAIResponse / serializeOpenAIStream（见 Task 3）。
// 本层平台无关、确定性纯函数：不注入时间戳/提示词（那是上游适配器的职责）。
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalMessage,
  CanonicalStreamEvent,
  ContentBlock,
  ToolResultContent,
  ToolDef,
  ToolChoice,
  StopReason,
} from '../../domain/canonical'

// ============ OpenAI 线协议类型（仅本转换器需要的子集） ============

export interface OpenAIToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAIContentPart {
  type: 'text' | 'image_url'
  text?: string
  image_url?: { url: string }
}

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | OpenAIContentPart[] | null
  name?: string
  tool_calls?: OpenAIToolCall[]
  tool_call_id?: string
}

export interface OpenAITool {
  type: 'function'
  function: { name: string; description?: string; parameters?: Record<string, unknown> }
}

export type OpenAIToolChoice =
  | 'auto'
  | 'none'
  | 'required'
  | { type: 'function'; function: { name: string } }

export interface OpenAIChatRequest {
  model: string
  messages: OpenAIMessage[]
  max_tokens?: number
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: OpenAITool[]
  tool_choice?: OpenAIToolChoice
  metadata?: Record<string, unknown>
}

// ============ 解析辅助 ============

// 解析 data URL（data:image/png;base64,xxxx）为 IR ImageBlock 字段。
// 仅支持 base64 data URL；http(s) 远程 URL 在 IR 层不内联（上游适配器若需要再处理），此处丢弃并返回 null。
function parseDataUrl(url: string): { mediaType: string; data: string } | null {
  const m = url.match(/^data:([^;]+);base64,(.+)$/)
  if (!m) return null
  return { mediaType: m[1], data: m[2] }
}

// 把 OpenAI content（string | parts | null）转为 IR ContentBlock[]（仅 text/image）。
function openAIContentToBlocks(content: OpenAIMessage['content']): ContentBlock[] {
  if (content == null) return []
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  const blocks: ContentBlock[] = []
  for (const part of content) {
    if (part.type === 'text' && part.text) {
      blocks.push({ type: 'text', text: part.text })
    } else if (part.type === 'image_url' && part.image_url?.url) {
      const parsed = parseDataUrl(part.image_url.url)
      if (parsed) blocks.push({ type: 'image', mediaType: parsed.mediaType, data: parsed.data })
    }
  }
  return blocks
}

// 把 OpenAI tool_calls 转为 IR ToolUseBlock[]；arguments 是 JSON 字符串，parse 失败回退为 {}。
function toolCallsToBlocks(toolCalls: OpenAIToolCall[]): ContentBlock[] {
  return toolCalls.map((tc) => {
    let input: Record<string, unknown> = {}
    try {
      const parsed = JSON.parse(tc.function.arguments || '{}')
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        input = parsed as Record<string, unknown>
      }
    } catch {
      // 容错：模型偶发产出非法 JSON arguments，按空对象处理而非整请求失败。
      input = {}
    }
    return { type: 'tool_use', id: tc.id, name: tc.function.name, input }
  })
}

// 把 OpenAI role:'tool' 消息转为单个 IR ToolResultBlock（content 收敛为 text/image）。
function toolMessageToResultBlock(msg: OpenAIMessage): ContentBlock {
  const inner = openAIContentToBlocks(msg.content)
  const resultContent: ToolResultContent[] = inner.filter(
    (b): b is ToolResultContent => b.type === 'text' || b.type === 'image',
  )
  return {
    type: 'tool_result',
    toolUseId: msg.tool_call_id ?? '',
    content: resultContent.length > 0 ? resultContent : [{ type: 'text', text: '' }],
  }
}

function mapToolChoice(choice: OpenAIToolChoice | undefined): ToolChoice | undefined {
  if (choice === undefined) return undefined
  if (choice === 'auto') return { type: 'auto' }
  if (choice === 'none') return { type: 'none' }
  if (choice === 'required') return { type: 'any' }
  if (typeof choice === 'object' && choice.type === 'function') {
    return { type: 'tool', name: choice.function.name }
  }
  return undefined
}

function mapTools(tools: OpenAITool[] | undefined): ToolDef[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    name: t.function.name,
    ...(t.function.description !== undefined ? { description: t.function.description } : {}),
    inputSchema: t.function.parameters ?? {},
  }))
}

// ============ openaiToIR ============

/**
 * OpenAI Chat Completions 请求 → CanonicalRequest。
 * - system 消息（可多段）收敛为 system 字符串（'\n' 连接）。
 * - user/assistant 消息转 IR 消息；assistant 的 tool_calls 追加为 tool_use 块。
 * - tool 角色消息归并进**紧随的一条 user 消息**：连续 tool 消息合并到同一条 user 消息的 tool_result 列表，
 *   再与后续 user 文本/图片合并（OpenAI 把工具结果作为独立 tool 消息，IR 把它放进 user.content）。
 */
export function openaiToIR(req: OpenAIChatRequest): CanonicalRequest {
  const systemParts: string[] = []
  const messages: CanonicalMessage[] = []
  // 累积「尚未落地」的 user 侧内容（含 tool_result），遇到 assistant 或结尾时 flush。
  let pendingUser: ContentBlock[] = []

  const flushPendingUser = (): void => {
    if (pendingUser.length > 0) {
      messages.push({ role: 'user', content: pendingUser })
      pendingUser = []
    }
  }

  for (const msg of req.messages) {
    if (msg.role === 'system') {
      const text =
        typeof msg.content === 'string'
          ? msg.content
          : openAIContentToBlocks(msg.content)
              .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
              .map((b) => b.text)
              .join('\n')
      if (text) systemParts.push(text)
    } else if (msg.role === 'tool') {
      pendingUser.push(toolMessageToResultBlock(msg))
    } else if (msg.role === 'user') {
      pendingUser.push(...openAIContentToBlocks(msg.content))
    } else {
      // assistant：先 flush 之前累积的 user 内容，再落 assistant 消息。
      flushPendingUser()
      const blocks: ContentBlock[] = openAIContentToBlocks(msg.content)
      if (msg.tool_calls && msg.tool_calls.length > 0) {
        blocks.push(...toolCallsToBlocks(msg.tool_calls))
      }
      messages.push({ role: 'assistant', content: blocks })
    }
  }
  flushPendingUser()

  const ir: CanonicalRequest = {
    model: req.model,
    messages,
    stream: req.stream ?? false,
  }
  if (systemParts.length > 0) ir.system = systemParts.join('\n')
  if (req.max_tokens !== undefined) ir.maxTokens = req.max_tokens
  if (req.temperature !== undefined) ir.temperature = req.temperature
  if (req.top_p !== undefined) ir.topP = req.top_p
  const tools = mapTools(req.tools)
  if (tools) ir.tools = tools
  const toolChoice = mapToolChoice(req.tool_choice)
  if (toolChoice) ir.toolChoice = toolChoice
  if (req.metadata !== undefined) ir.metadata = req.metadata
  return ir
}

// ============ IR → OpenAI（响应） ============

export interface OpenAIResponseToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
}

export interface OpenAIUsage {
  prompt_tokens: number
  completion_tokens: number
  total_tokens: number
  prompt_tokens_details?: { cached_tokens: number }
}

export interface OpenAIChatCompletion {
  id: string
  object: 'chat.completion'
  created: number
  model: string
  choices: {
    index: number
    message: {
      role: 'assistant'
      content: string | null
      tool_calls?: OpenAIResponseToolCall[]
    }
    finish_reason: 'stop' | 'length' | 'tool_calls'
  }[]
  usage: OpenAIUsage
}

/** id/created 注入项（不变量 9：转换器不读时钟/随机）。 */
export interface OpenAIResponseOpts {
  id?: string
  created?: number
}

// IR StopReason → OpenAI finish_reason（不变量 6）。
function stopReasonToOpenAI(reason: StopReason): 'stop' | 'length' | 'tool_calls' {
  switch (reason) {
    case 'max_tokens':
      return 'length'
    case 'tool_use':
      return 'tool_calls'
    case 'end_turn':
    case 'stop_sequence':
      return 'stop'
  }
}

// IR Usage → OpenAI usage（不变量 7）。
function usageToOpenAI(usage: CanonicalResponse['usage']): OpenAIUsage {
  const out: OpenAIUsage = {
    prompt_tokens: usage.inputTokens,
    completion_tokens: usage.outputTokens,
    total_tokens: usage.inputTokens + usage.outputTokens,
  }
  if (usage.cacheReadTokens !== undefined) {
    out.prompt_tokens_details = { cached_tokens: usage.cacheReadTokens }
  }
  return out
}

/**
 * CanonicalResponse → OpenAI chat.completion 对象。
 * - text 块拼成 message.content；tool_use 块转 tool_calls（input JSON.stringify）。
 * - 有 tool_calls 时 content 置 null（OpenAI 惯例）；否则 content 为拼接文本（可能为空串）。
 * - thinking 块在 OpenAI Chat 无原生承载，丢弃（不变量：显式丢弃并注释）。
 */
export function irToOpenAIResponse(
  resp: CanonicalResponse,
  opts: OpenAIResponseOpts = {},
): OpenAIChatCompletion {
  let text = ''
  const toolCalls: OpenAIResponseToolCall[] = []
  for (const block of resp.content) {
    if (block.type === 'text') {
      text += block.text
    } else if (block.type === 'tool_use') {
      toolCalls.push({
        id: block.id,
        type: 'function',
        function: { name: block.name, arguments: JSON.stringify(block.input) },
      })
    }
    // image/tool_result 不会出现在响应侧；thinking 在 OpenAI Chat 无字段承载，丢弃。
  }
  const hasToolCalls = toolCalls.length > 0
  return {
    id: opts.id ?? 'chatcmpl-0',
    object: 'chat.completion',
    created: opts.created ?? 0,
    model: resp.model,
    choices: [
      {
        index: 0,
        message: {
          role: 'assistant',
          content: hasToolCalls ? null : text,
          ...(hasToolCalls ? { tool_calls: toolCalls } : {}),
        },
        finish_reason: stopReasonToOpenAI(resp.stopReason),
      },
    ],
    usage: usageToOpenAI(resp.usage),
  }
}

// ============ IR → OpenAI（流式 SSE） ============

/** 流式注入项（不变量 9）。 */
export interface OpenAIStreamOpts {
  id?: string
  created?: number
}

interface OpenAIStreamChunk {
  id: string
  object: 'chat.completion.chunk'
  created: number
  model: string
  choices: {
    index: number
    delta: {
      role?: 'assistant'
      content?: string
      tool_calls?: {
        index: number
        id?: string
        type?: 'function'
        function?: { name?: string; arguments?: string }
      }[]
    }
    finish_reason: 'stop' | 'length' | 'tool_calls' | null
  }[]
  usage?: OpenAIUsage
}

// 把一个 chunk 对象包成一条 SSE 帧文本。
function sseFrame(chunk: OpenAIStreamChunk): string {
  return `data: ${JSON.stringify(chunk)}\n\n`
}

/**
 * IR 事件序列 → OpenAI SSE chat.completion.chunk 帧字符串数组。
 * 帧序：首帧（delta.role=assistant）→ 文本/思考/工具增量帧 → 收尾帧（delta 空 + finish_reason）→ `data: [DONE]`。
 * - text_delta → delta.content；thinking_delta 在 OpenAI Chat 无原生字段，丢弃（注释说明）。
 * - tool_use_start → delta.tool_calls[{ index, id, function.name, arguments:'' }]；tool_use_delta → arguments 片段。
 * - usage 事件 → 追加一条仅含 usage 的帧（OpenAI stream_options.include_usage 风格）。
 * - message_stop → 决定收尾帧 finish_reason（不变量 6）。
 * 纯函数：id/created 来自 opts，缺省 'chatcmpl-0'/0。
 */
export function serializeOpenAIStream(
  events: CanonicalStreamEvent[],
  model: string,
  opts: OpenAIStreamOpts = {},
): string[] {
  const id = opts.id ?? 'chatcmpl-0'
  const created = opts.created ?? 0
  const base = (
    delta: OpenAIStreamChunk['choices'][0]['delta'],
    finishReason: OpenAIStreamChunk['choices'][0]['finish_reason'],
    usage?: OpenAIUsage,
  ): OpenAIStreamChunk => ({
    id,
    object: 'chat.completion.chunk',
    created,
    model,
    choices: [{ index: 0, delta, finish_reason: finishReason }],
    ...(usage ? { usage } : {}),
  })

  const frames: string[] = []
  // 首帧：宣告 assistant 角色。
  frames.push(sseFrame(base({ role: 'assistant' }, null)))

  let finishReason: 'stop' | 'length' | 'tool_calls' = 'stop'
  for (const ev of events) {
    if (ev.type === 'text_delta') {
      frames.push(sseFrame(base({ content: ev.text }, null)))
    } else if (ev.type === 'thinking_delta') {
      // OpenAI Chat Completions 无 thinking 流字段，丢弃以免产出非法帧。
    } else if (ev.type === 'tool_use_start') {
      // 首工具帧只带 id + name（对齐 OpenAI 线格式：arguments 在后续 delta 帧累积，
      // 这里不放空串 arguments，否则会和真正的 arguments 片段混在一起难以区分）。
      frames.push(
        sseFrame(
          base(
            { tool_calls: [{ index: ev.index, id: ev.id, type: 'function', function: { name: ev.name } }] },
            null,
          ),
        ),
      )
    } else if (ev.type === 'tool_use_delta') {
      frames.push(
        sseFrame(base({ tool_calls: [{ index: ev.index, function: { arguments: ev.partialJson } }] }, null)),
      )
    } else if (ev.type === 'usage') {
      frames.push(sseFrame(base({}, null, usageToOpenAI(ev.usage))))
    } else {
      // message_stop：记录最终 finish_reason，收尾帧在循环后统一发。
      finishReason = stopReasonToOpenAI(ev.stopReason)
    }
  }

  // 收尾帧：空 delta + finish_reason。
  frames.push(sseFrame(base({}, finishReason)))
  frames.push('data: [DONE]\n\n')
  return frames
}
