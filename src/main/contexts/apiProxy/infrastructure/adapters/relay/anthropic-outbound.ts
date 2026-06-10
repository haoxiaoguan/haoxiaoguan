// 第三方中转「出站」镜像转换器：Canonical IR ↔ Anthropic Messages（上游方向）。
// IR 借鉴 Anthropic Messages 的 block 模型，故此映射接近恒等（字段重命名 + 方向翻转）。
// inbound/anthropic.ts 是「客户端线协议 ↔ IR」入站对；本文件是其镜像「IR ↔ 上游线协议」出站对:
//   - irToAnthropicRequest:          IR → 上游请求体（RelayAdapter 发给第三方时用）
//   - anthropicResponseToIR:         上游非流式 JSON → CanonicalResponse
//   - createAnthropicSseToEventsParser: 上游 SSE（增量、半帧）→ CanonicalStreamEvent[]
// 平台无关、确定性纯函数：不读时钟/随机；bytecode 安全：闭包工厂 + 对象方法，无 class 字段箭头。
// 禁：Date.now/Math.random/crypto.randomUUID；禁动态 import()。
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
  StopReason,
  Usage,
} from '../../../domain/canonical'
import type {
  AnthropicMessagesRequest,
  AnthropicMessage,
  AnthropicContentBlock,
  AnthropicMessageParam,
  AnthropicTool,
  AnthropicToolChoice,
} from '../../inbound/anthropic'
import type { RelayStreamParser } from './relay-codec'

// ============ IR → Anthropic 请求体 ============

/** Anthropic max_tokens 必填；IR 无则给合理默认。 */
const DEFAULT_MAX_TOKENS = 4096

/** IR ToolResultContent[] → Anthropic tool_result.content（string | AnthropicContentBlock[]）。 */
function irToolResultContentToAnthropic(content: CanonicalRequest['messages'][number]['content']): never {
  // 不直接用，见 irBlockToAnthropicRequest 内联处理
  throw new Error('unreachable')
  return content as never
}
void irToolResultContentToAnthropic // suppress unused warning

/** IR ContentBlock → Anthropic content block（请求侧：text/image/tool_use/tool_result/thinking）。 */
function irBlockToAnthropicRequest(block: ContentBlock): AnthropicContentBlock {
  if (block.type === 'text') {
    return { type: 'text', text: block.text }
  }
  if (block.type === 'image') {
    return {
      type: 'image',
      source: { type: 'base64', media_type: block.mediaType, data: block.data },
    }
  }
  if (block.type === 'thinking') {
    return {
      type: 'thinking',
      thinking: block.text,
      ...(block.signature !== undefined ? { signature: block.signature } : {}),
    }
  }
  if (block.type === 'tool_use') {
    return {
      type: 'tool_use',
      id: block.id,
      name: block.name,
      input: block.input,
    }
  }
  // tool_result
  const trBlock = block as Extract<ContentBlock, { type: 'tool_result' }>
  const trContent: AnthropicContentBlock[] = trBlock.content.map((c) => {
    if (c.type === 'text') return { type: 'text', text: c.text }
    // image
    return {
      type: 'image',
      source: { type: 'base64', media_type: c.mediaType, data: c.data },
    }
  })
  const result: AnthropicContentBlock = {
    type: 'tool_result',
    tool_use_id: trBlock.toolUseId,
    content: trContent,
  }
  if (trBlock.isError !== undefined) result.is_error = trBlock.isError
  return result
}

/**
 * CanonicalRequest → Anthropic Messages 请求体（anthropicToIR 的逆）。
 * - ir.system（字符串）→ Anthropic system 字符串（或省略）。
 * - messages content blocks 近恒等渲染：text/image/tool_use/tool_result/thinking。
 * - tools：ToolDef → { name, description?, input_schema }。
 * - tool_choice：auto/any/none/tool 同构直传。
 * - max_tokens：Anthropic 必填，IR 无则给默认 4096。
 * - thinking：enabled/disabled + budget_tokens。
 */
export function irToAnthropicRequest(ir: CanonicalRequest): AnthropicMessagesRequest {
  const messages: AnthropicMessageParam[] = ir.messages.map((m) => ({
    role: m.role,
    content: m.content.map(irBlockToAnthropicRequest),
  }))

  const out: AnthropicMessagesRequest = {
    model: ir.model,
    messages,
    max_tokens: ir.maxTokens ?? DEFAULT_MAX_TOKENS,
  }

  if (ir.system !== undefined && ir.system.length > 0) out.system = ir.system
  if (ir.temperature !== undefined) out.temperature = ir.temperature
  if (ir.topP !== undefined) out.top_p = ir.topP
  if (ir.stream !== undefined) out.stream = ir.stream

  if (ir.tools && ir.tools.length > 0) {
    const tools: AnthropicTool[] = ir.tools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      input_schema: t.inputSchema,
    }))
    out.tools = tools
  }

  if (ir.toolChoice !== undefined) {
    // IR ToolChoice is structurally identical to AnthropicToolChoice
    out.tool_choice = ir.toolChoice as AnthropicToolChoice
  }

  if (ir.thinking !== undefined) {
    if (ir.thinking.type === 'enabled') {
      out.thinking = {
        type: 'enabled',
        ...(ir.thinking.budgetTokens !== undefined ? { budget_tokens: ir.thinking.budgetTokens } : {}),
      }
    } else {
      out.thinking = { type: 'disabled' }
    }
  }

  if (ir.metadata !== undefined) out.metadata = ir.metadata

  return out
}

// ============ Anthropic 响应 → IR ============

/** Anthropic stop_reason → IR StopReason（近恒等，同名直传）。 */
function stopReasonToIR(reason: string | null | undefined): StopReason {
  switch (reason) {
    case 'end_turn':
      return 'end_turn'
    case 'max_tokens':
      return 'max_tokens'
    case 'tool_use':
      return 'tool_use'
    case 'stop_sequence':
      return 'stop_sequence'
    default:
      return 'end_turn'
  }
}

/** Anthropic response usage → IR Usage。 */
function usageFromAnthropic(u: AnthropicMessage['usage']): Usage {
  const usage: Usage = {
    inputTokens: u.input_tokens,
    outputTokens: u.output_tokens,
  }
  if (u.cache_read_input_tokens !== undefined) usage.cacheReadTokens = u.cache_read_input_tokens
  if (u.cache_creation_input_tokens !== undefined) usage.cacheWriteTokens = u.cache_creation_input_tokens
  return usage
}

/** Anthropic response content block → IR ContentBlock（响应侧：text/tool_use/thinking）。 */
function anthropicBlockToIR(block: AnthropicContentBlock): ContentBlock | null {
  if (block.type === 'text' && block.text !== undefined) {
    return { type: 'text', text: block.text }
  }
  if (block.type === 'thinking' && block.thinking !== undefined) {
    return {
      type: 'thinking',
      text: block.thinking,
      ...(block.signature !== undefined ? { signature: block.signature } : {}),
    }
  }
  if (block.type === 'tool_use' && block.id && block.name) {
    return { type: 'tool_use', id: block.id, name: block.name, input: block.input ?? {} }
  }
  return null
}

/**
 * Anthropic Message 响应 → CanonicalResponse（irToAnthropicResponse 的逆）。
 * content blocks（text/tool_use/thinking）→ IR ContentBlock；
 * stop_reason 近恒等；usage 含 cache 读写字段。
 */
export function anthropicResponseToIR(raw: AnthropicMessage): CanonicalResponse {
  const content: ContentBlock[] = []
  for (const block of raw.content) {
    const irBlock = anthropicBlockToIR(block)
    if (irBlock !== null) content.push(irBlock)
  }
  return {
    model: raw.model,
    content,
    stopReason: stopReasonToIR(raw.stop_reason),
    usage: usageFromAnthropic(raw.usage),
  }
}

// ============ Anthropic SSE → IR 事件（增量状态机） ============

// 内部 SSE 解析用的结构（Anthropic 流式帧 JSON 形状）。

interface AnthropicSseMessageStart {
  type: 'message_start'
  message: {
    usage?: { input_tokens?: number }
  }
}

interface AnthropicSseContentBlockStart {
  type: 'content_block_start'
  index: number
  content_block: {
    type: 'text' | 'tool_use' | 'thinking' | string
    id?: string
    name?: string
  }
}

interface AnthropicSseContentBlockDelta {
  type: 'content_block_delta'
  index: number
  delta: {
    type: 'text_delta' | 'input_json_delta' | 'thinking_delta' | 'signature_delta' | string
    text?: string        // text_delta
    partial_json?: string // input_json_delta
    thinking?: string    // thinking_delta
  }
}

interface AnthropicSseMessageDelta {
  type: 'message_delta'
  delta: {
    stop_reason?: string | null
    stop_sequence?: string | null
  }
  usage?: {
    output_tokens?: number
  }
}

type AnthropicSseFrame =
  | AnthropicSseMessageStart
  | AnthropicSseContentBlockStart
  | AnthropicSseContentBlockDelta
  | AnthropicSseMessageDelta
  | { type: 'content_block_stop'; index: number }
  | { type: 'message_stop' }
  | { type: 'ping' }
  | { type: string }

/**
 * 创建 Anthropic Messages SSE → IR 事件流的增量解析器。
 * 处理：半帧缓冲（按 \n 切行）、`data: {json}`（以 JSON type 字段判别），
 * Anthropic SSE 事件映射（见下），畸形帧跳过，不中断。
 *
 * 映射规则：
 *   message_start       → 记录 input_tokens（末尾随 usage 事件 emit）
 *   content_block_start → tool_use → tool_use_start；text/thinking → 无事件（等 delta）
 *   content_block_delta → text_delta→text_delta; input_json_delta→tool_use_delta;
 *                         thinking_delta→thinking_delta; signature_delta→忽略
 *   content_block_stop  → 无事件
 *   message_delta       → stop_reason→message_stop; output_tokens→usage（顺序：stop 在前，usage 在后）
 *   message_stop/ping   → 无事件
 */
export function createAnthropicSseToEventsParser(): RelayStreamParser {
  let buffer = ''
  let inputTokensAccum = 0
  let outputTokensAccum = 0

  function processDataLine(line: string): CanonicalStreamEvent[] {
    const events: CanonicalStreamEvent[] = []
    const trimmed = line.replace(/\r$/, '').trimStart()
    // 只处理 data: 行；event:/注释/空行跳过
    if (!trimmed.startsWith('data:')) return events
    const data = trimmed.slice('data:'.length).trim()
    if (data === '') return events

    let frame: AnthropicSseFrame
    try {
      frame = JSON.parse(data) as AnthropicSseFrame
    } catch {
      return events // 畸形 JSON 跳过
    }

    const t = frame.type

    if (t === 'message_start') {
      const f = frame as AnthropicSseMessageStart
      inputTokensAccum = f.message?.usage?.input_tokens ?? 0
      // 不立即 emit；usage 事件在 message_delta 时发出
    } else if (t === 'content_block_start') {
      const f = frame as AnthropicSseContentBlockStart
      if (f.content_block.type === 'tool_use') {
        events.push({
          type: 'tool_use_start',
          index: f.index,
          id: f.content_block.id ?? '',
          name: f.content_block.name ?? '',
        })
      }
      // text/thinking → 无事件（等 delta）
    } else if (t === 'content_block_delta') {
      const f = frame as AnthropicSseContentBlockDelta
      const dt = f.delta.type
      if (dt === 'text_delta' && f.delta.text !== undefined) {
        events.push({ type: 'text_delta', text: f.delta.text })
      } else if (dt === 'input_json_delta' && f.delta.partial_json !== undefined) {
        events.push({ type: 'tool_use_delta', index: f.index, partialJson: f.delta.partial_json })
      } else if (dt === 'thinking_delta' && f.delta.thinking !== undefined) {
        events.push({ type: 'thinking_delta', text: f.delta.thinking })
      }
      // signature_delta → 忽略
    } else if (t === 'message_delta') {
      const f = frame as AnthropicSseMessageDelta
      // 累积 output_tokens
      outputTokensAccum = f.usage?.output_tokens ?? outputTokensAccum
      // emit message_stop（顺序：stop 在前）
      const stopReason = stopReasonToIR(f.delta?.stop_reason)
      events.push({ type: 'message_stop', stopReason })
      // emit usage（顺序：usage 在后）
      const usage: Usage = {
        inputTokens: inputTokensAccum,
        outputTokens: outputTokensAccum,
      }
      events.push({ type: 'usage', usage })
    }
    // content_block_stop / message_stop / ping → 无事件

    return events
  }

  return {
    push(textChunk: string): CanonicalStreamEvent[] {
      buffer += textChunk
      const events: CanonicalStreamEvent[] = []
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        for (const ev of processDataLine(line)) events.push(ev)
        nl = buffer.indexOf('\n')
      }
      return events
    },
    flush(): CanonicalStreamEvent[] {
      if (buffer.trim() === '') {
        buffer = ''
        return []
      }
      const events = processDataLine(buffer)
      buffer = ''
      return events
    },
  }
}

/** 便捷：把完整 Anthropic SSE 文本一次性解析成 IR 事件序列（测试/非流式场景用）。 */
export function parseAnthropicSse(fullSseText: string): CanonicalStreamEvent[] {
  const parser = createAnthropicSseToEventsParser()
  return [...parser.push(fullSseText), ...parser.flush()]
}
