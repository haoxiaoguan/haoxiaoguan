// 入站转换器：Anthropic Messages ↔ 规范 IR。
// IR 借鉴 Anthropic Messages 模型，故此组映射最接近恒等（仅做字段重命名 + system 收敛）。
// 本层平台无关、确定性纯函数：不读时钟/不发 I/O；id 由 opts 注入（不变量 9）。
import type {
  CanonicalRequest,
  CanonicalMessage,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
  ToolResultContent,
  ToolDef,
  ToolChoice,
  ThinkingConfig,
  StopReason,
  Usage,
  CacheBreakpointInput,
} from '../../domain/canonical'
import { countTextTokens } from '../../domain/usage/token-estimator'

// ============ Anthropic 线协议类型（子集） ============

export interface AnthropicImageSource {
  type: 'base64'
  media_type: string
  data: string
}

export interface AnthropicContentBlock {
  type: 'text' | 'image' | 'tool_use' | 'tool_result' | 'thinking'
  text?: string
  thinking?: string
  signature?: string
  source?: AnthropicImageSource
  id?: string
  name?: string
  input?: Record<string, unknown>
  tool_use_id?: string
  content?: string | AnthropicContentBlock[]
  is_error?: boolean
  cache_control?: { type: string; ttl?: string }
}

export interface AnthropicMessageParam {
  role: 'user' | 'assistant'
  content: string | AnthropicContentBlock[]
}

export interface AnthropicSystemBlock {
  type: 'text'
  text: string
  cache_control?: { type: string; ttl?: string }
}

export interface AnthropicTool {
  name: string
  description?: string
  input_schema: Record<string, unknown>
  cache_control?: { type: string; ttl?: string }
}

export type AnthropicToolChoice =
  | { type: 'auto' }
  | { type: 'any' }
  | { type: 'none' }
  | { type: 'tool'; name: string }

export interface AnthropicThinking {
  type: 'enabled' | 'disabled'
  budget_tokens?: number
}

export interface AnthropicMessagesRequest {
  model: string
  messages: AnthropicMessageParam[]
  max_tokens: number
  system?: string | AnthropicSystemBlock[]
  temperature?: number
  top_p?: number
  stream?: boolean
  tools?: AnthropicTool[]
  tool_choice?: AnthropicToolChoice
  thinking?: AnthropicThinking
  metadata?: Record<string, unknown>
}

// ============ 解析辅助 ============

function anthropicSystemToString(system: AnthropicMessagesRequest['system']): string | undefined {
  if (system === undefined) return undefined
  if (typeof system === 'string') return system || undefined
  const parts = system.filter((b) => b.type === 'text').map((b) => b.text)
  return parts.length > 0 ? parts.join('\n') : undefined
}

// tool_result.content（string | blocks）→ IR ToolResultContent[]（仅 text/image）。
function toolResultContentToIR(content: AnthropicContentBlock['content']): ToolResultContent[] {
  if (content === undefined) return [{ type: 'text', text: '' }]
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  const out: ToolResultContent[] = []
  for (const b of content) {
    if (b.type === 'text' && b.text !== undefined) {
      out.push({ type: 'text', text: b.text })
    } else if (b.type === 'image' && b.source) {
      out.push({ type: 'image', mediaType: b.source.media_type, data: b.source.data })
    }
  }
  return out.length > 0 ? out : [{ type: 'text', text: '' }]
}

// Anthropic content blocks → IR ContentBlock[]。
function anthropicBlocksToIR(content: AnthropicMessageParam['content']): ContentBlock[] {
  if (typeof content === 'string') {
    return content ? [{ type: 'text', text: content }] : []
  }
  const out: ContentBlock[] = []
  for (const b of content) {
    if (b.type === 'text' && b.text !== undefined) {
      out.push({ type: 'text', text: b.text })
    } else if (b.type === 'image' && b.source) {
      out.push({ type: 'image', mediaType: b.source.media_type, data: b.source.data })
    } else if (b.type === 'thinking' && b.thinking !== undefined) {
      out.push({
        type: 'thinking',
        text: b.thinking,
        ...(b.signature !== undefined ? { signature: b.signature } : {}),
      })
    } else if (b.type === 'tool_use' && b.id && b.name) {
      out.push({ type: 'tool_use', id: b.id, name: b.name, input: b.input ?? {} })
    } else if (b.type === 'tool_result' && b.tool_use_id) {
      out.push({
        type: 'tool_result',
        toolUseId: b.tool_use_id,
        content: toolResultContentToIR(b.content),
        ...(b.is_error !== undefined ? { isError: b.is_error } : {}),
      })
    }
  }
  return out
}

function mapAnthropicToolChoice(choice: AnthropicToolChoice | undefined): ToolChoice | undefined {
  if (choice === undefined) return undefined
  // Anthropic 的取值与 IR ToolChoice 同构，直传。
  return choice
}

function mapAnthropicTools(tools: AnthropicTool[] | undefined): ToolDef[] | undefined {
  if (!tools || tools.length === 0) return undefined
  return tools.map((t) => ({
    name: t.name,
    ...(t.description !== undefined ? { description: t.description } : {}),
    inputSchema: t.input_schema ?? {},
  }))
}

function mapAnthropicThinking(thinking: AnthropicThinking | undefined): ThinkingConfig | undefined {
  if (thinking === undefined) return undefined
  if (thinking.type === 'enabled') {
    return { type: 'enabled', ...(thinking.budget_tokens !== undefined ? { budgetTokens: thinking.budget_tokens } : {}) }
  }
  return { type: 'disabled' }
}

// ============ prompt cache 断点提取 ============

const DEFAULT_TTL_MS = 5 * 60 * 1000
const ONE_HOUR_MS = 60 * 60 * 1000

// cache_control → TTL（毫秒）。仅 ephemeral 生效；ttl='1h' 取 1 小时，否则默认 5 分钟。
function extractTTL(cc: { type: string; ttl?: string } | undefined): number {
  if (cc === undefined || String(cc.type).toLowerCase() !== 'ephemeral') return 0
  if (cc.ttl === '1h') return ONE_HOUR_MS
  return DEFAULT_TTL_MS
}

// 按 tools → system → messages 顺序展开缓存断点（旁路元信息，纯函数，不读时钟）。
function extractCacheBlocks(req: AnthropicMessagesRequest): CacheBreakpointInput[] {
  const out: CacheBreakpointInput[] = []
  for (const t of req.tools ?? []) {
    const v = JSON.stringify({ k: 'tool', name: t.name, desc: t.description, schema: t.input_schema })
    out.push({
      value: v,
      tokens: countTextTokens(`${t.name} ${t.description ?? ''} ${JSON.stringify(t.input_schema)}`),
      ttl: extractTTL(t.cache_control),
      isMessageEnd: false,
    })
  }
  if (Array.isArray(req.system)) {
    for (const b of req.system) {
      out.push({
        value: JSON.stringify({ k: 'sys', text: b.text }),
        tokens: countTextTokens(b.text),
        ttl: extractTTL(b.cache_control),
        isMessageEnd: false,
      })
    }
  } else if (typeof req.system === 'string' && req.system.length > 0) {
    out.push({ value: JSON.stringify({ k: 'sys', text: req.system }), tokens: countTextTokens(req.system), ttl: 0, isMessageEnd: false })
  }
  req.messages.forEach((m, mi) => {
    const blocks = typeof m.content === 'string' ? [{ type: 'text', text: m.content } as AnthropicContentBlock] : m.content
    blocks.forEach((b, bi) => {
      const text = b.text ?? b.thinking ?? ''
      out.push({
        value: JSON.stringify({ k: 'msg', role: m.role, mi, bi, type: b.type, text }),
        tokens: countTextTokens(text || JSON.stringify(b)),
        ttl: extractTTL(b.cache_control),
        isMessageEnd: bi === blocks.length - 1,
      })
    })
  })
  return out
}

// ============ anthropicToIR ============

/** Anthropic Messages 请求 → CanonicalRequest（近恒等映射）。 */
export function anthropicToIR(req: AnthropicMessagesRequest): CanonicalRequest {
  const messages: CanonicalMessage[] = req.messages.map((m) => ({
    role: m.role,
    content: anthropicBlocksToIR(m.content),
  }))
  const ir: CanonicalRequest = {
    model: req.model,
    messages,
    stream: req.stream ?? false,
  }
  const system = anthropicSystemToString(req.system)
  if (system !== undefined) ir.system = system
  if (req.max_tokens !== undefined) ir.maxTokens = req.max_tokens
  if (req.temperature !== undefined) ir.temperature = req.temperature
  if (req.top_p !== undefined) ir.topP = req.top_p
  const tools = mapAnthropicTools(req.tools)
  if (tools) ir.tools = tools
  const toolChoice = mapAnthropicToolChoice(req.tool_choice)
  if (toolChoice) ir.toolChoice = toolChoice
  const thinking = mapAnthropicThinking(req.thinking)
  if (thinking) ir.thinking = thinking
  if (req.metadata !== undefined) ir.metadata = req.metadata
  // 仅当存在至少一个有效 TTL 断点时填充旁路 cacheControl（否则保持 undefined）。
  const cacheBlocks = extractCacheBlocks(req)
  if (cacheBlocks.some((b) => b.ttl > 0)) ir.cacheControl = cacheBlocks
  return ir
}

// ============ IR → Anthropic（响应） ============

export interface AnthropicResponseUsage {
  input_tokens: number
  output_tokens: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

export interface AnthropicMessage {
  id: string
  type: 'message'
  role: 'assistant'
  model: string
  content: AnthropicContentBlock[]
  stop_reason: StopReason
  stop_sequence: string | null
  usage: AnthropicResponseUsage
}

export interface AnthropicResponseOpts {
  id?: string
}

// IR Usage → Anthropic usage（不变量 7）。
function usageToAnthropic(usage: Usage): AnthropicResponseUsage {
  const out: AnthropicResponseUsage = {
    input_tokens: usage.inputTokens,
    output_tokens: usage.outputTokens,
  }
  if (usage.cacheReadTokens !== undefined) out.cache_read_input_tokens = usage.cacheReadTokens
  if (usage.cacheWriteTokens !== undefined) out.cache_creation_input_tokens = usage.cacheWriteTokens
  return out
}

// IR ContentBlock → Anthropic content block（响应侧仅 text/thinking/tool_use 出现）。
function irBlockToAnthropic(block: ContentBlock): AnthropicContentBlock {
  if (block.type === 'text') return { type: 'text', text: block.text }
  if (block.type === 'thinking') {
    return {
      type: 'thinking',
      thinking: block.text,
      ...(block.signature !== undefined ? { signature: block.signature } : {}),
    }
  }
  if (block.type === 'tool_use') {
    return { type: 'tool_use', id: block.id, name: block.name, input: block.input }
  }
  if (block.type === 'image') {
    return { type: 'image', source: { type: 'base64', media_type: block.mediaType, data: block.data } }
  }
  // tool_result 不会出现在响应 content；兜底转成 text 以保证类型完整。
  return { type: 'text', text: '' }
}

/** CanonicalResponse → Anthropic Message 对象（stop_reason 同名直传）。 */
export function irToAnthropicResponse(
  resp: CanonicalResponse,
  opts: AnthropicResponseOpts = {},
): AnthropicMessage {
  return {
    id: opts.id ?? 'msg_0',
    type: 'message',
    role: 'assistant',
    model: resp.model,
    content: resp.content.map(irBlockToAnthropic),
    stop_reason: resp.stopReason,
    stop_sequence: null,
    usage: usageToAnthropic(resp.usage),
  }
}

// ============ IR → Anthropic（流式 SSE） ============

export interface AnthropicStreamOpts {
  id?: string
}

// 包成一条 Anthropic SSE 帧（双行：event + data）。
function anthropicSseFrame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

/**
 * IR 事件序列 → Anthropic Messages 流式 SSE 帧。
 * 帧序：message_start → 对每个内容块 content_block_start/…content_block_delta…/content_block_stop
 *      → message_delta（stop_reason + 累计 output usage）→ message_stop。
 * - text_delta / thinking_delta：归属「当前文本/思考块」（首次出现时先发该块的 content_block_start）。
 * - tool_use_start：开一个 tool_use 块（content_block_start，input:{}）；tool_use_delta：input_json_delta。
 * - usage 事件：记录最终 output_tokens，用于 message_delta。
 * resp 参数提供 message_start 的初始 usage(input_tokens) 与 model。纯函数：id 来自 opts。
 */
export function serializeAnthropicStream(
  resp: CanonicalResponse,
  events: CanonicalStreamEvent[],
  opts: AnthropicStreamOpts = {},
): string[] {
  const id = opts.id ?? 'msg_0'
  const frames: string[] = []

  // message_start 的 cache 用量：优先取流末 usage 事件（含 cache 读写），退回 resp.usage。
  const usageEv = events.find((e): e is Extract<CanonicalStreamEvent, { type: 'usage' }> => e.type === 'usage')
  const startCache = usageEv?.usage ?? resp.usage

  // message_start：初始 usage 用 resp.usage 的 input（output 起步 0），cache 字段按规范补充。
  frames.push(
    anthropicSseFrame('message_start', {
      type: 'message_start',
      message: {
        id,
        type: 'message',
        role: 'assistant',
        model: resp.model,
        content: [],
        stop_reason: null,
        stop_sequence: null,
        usage: {
          input_tokens: resp.usage.inputTokens,
          output_tokens: 0,
          ...(startCache.cacheReadTokens !== undefined ? { cache_read_input_tokens: startCache.cacheReadTokens } : {}),
          ...(startCache.cacheWriteTokens !== undefined ? { cache_creation_input_tokens: startCache.cacheWriteTokens } : {}),
        },
      },
    }),
  )

  // 当前打开的块状态机：用 blockIndex 追踪 content_block 序号。
  let blockIndex = -1
  let openKind: 'text' | 'thinking' | 'tool_use' | null = null
  let finalStop: StopReason = resp.stopReason
  let finalOutputTokens = resp.usage.outputTokens

  const closeOpenBlock = (): void => {
    if (openKind !== null) {
      frames.push(anthropicSseFrame('content_block_stop', { type: 'content_block_stop', index: blockIndex }))
      openKind = null
    }
  }

  const openTextLike = (kind: 'text' | 'thinking'): void => {
    if (openKind !== kind) {
      closeOpenBlock()
      blockIndex += 1
      const contentBlock =
        kind === 'text' ? { type: 'text', text: '' } : { type: 'thinking', thinking: '', signature: '' }
      frames.push(
        anthropicSseFrame('content_block_start', { type: 'content_block_start', index: blockIndex, content_block: contentBlock }),
      )
      openKind = kind
    }
  }

  for (const ev of events) {
    if (ev.type === 'text_delta') {
      openTextLike('text')
      frames.push(
        anthropicSseFrame('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'text_delta', text: ev.text },
        }),
      )
    } else if (ev.type === 'thinking_delta') {
      openTextLike('thinking')
      frames.push(
        anthropicSseFrame('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'thinking_delta', thinking: ev.text },
        }),
      )
    } else if (ev.type === 'tool_use_start') {
      closeOpenBlock()
      blockIndex += 1
      frames.push(
        anthropicSseFrame('content_block_start', {
          type: 'content_block_start',
          index: blockIndex,
          content_block: { type: 'tool_use', id: ev.id, name: ev.name, input: {} },
        }),
      )
      openKind = 'tool_use'
    } else if (ev.type === 'tool_use_delta') {
      frames.push(
        anthropicSseFrame('content_block_delta', {
          type: 'content_block_delta',
          index: blockIndex,
          delta: { type: 'input_json_delta', partial_json: ev.partialJson },
        }),
      )
    } else if (ev.type === 'usage') {
      finalOutputTokens = ev.usage.outputTokens
    } else {
      // message_stop 事件：记录最终 stop_reason，实际帧在循环后统一收尾。
      finalStop = ev.stopReason
    }
  }

  // 关闭最后一个未关闭的块。
  closeOpenBlock()

  // message_delta：携带 stop_reason 与累计 output usage。
  frames.push(
    anthropicSseFrame('message_delta', {
      type: 'message_delta',
      delta: { stop_reason: finalStop, stop_sequence: null },
      usage: { output_tokens: finalOutputTokens },
    }),
  )
  frames.push(anthropicSseFrame('message_stop', { type: 'message_stop' }))
  return frames
}
