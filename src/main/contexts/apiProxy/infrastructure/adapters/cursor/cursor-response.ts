// Cursor 响应帧解析（移植自 9router open-sse/executors/cursor.js 的帧循环），产出规范 IR。
// 缓冲式：整包字节读完后逐帧解（Connect-RPC 5 字节头 + 可选 gzip/deflate），与 9router 一致
// （9router 也是 await arrayBuffer() 后 reframe）。真增量（push/flush 半帧）留作后续优化。
import zlib from 'node:zlib'
import { extractTextFromResponse } from './cursor-protobuf'
import { isComposerModel } from './cursor-model-map'
import { countTextTokens, estimateRequestInputTokens } from '../../../domain/usage/token-estimator'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
  StopReason,
  Usage,
} from '../../../domain/canonical'

const COMPRESS_FLAG = { NONE: 0x00, GZIP: 0x01, TRAILER: 0x02, GZIP_TRAILER: 0x03 }

/** 上游返回的错误（JSON 错误帧或解码错误）。 */
export interface CursorUpstreamFault {
  message: string
  /** 是否额度/限速类（resource_exhausted）→ 上层映射 RATE_LIMIT。 */
  rateLimited: boolean
  /** 是否鉴权类（unauthenticated / ERROR_NOT_LOGGED_IN）→ 上层映射 AUTH（token 失效，切号/刷新）。 */
  unauthenticated: boolean
}

interface ParsedCursor {
  text: string
  thinking: string
  toolCalls: Array<{ id: string; name: string; args: string }>
  fault?: CursorUpstreamFault
}

function decompressPayload(payload: Uint8Array, flags: number): Uint8Array {
  // JSON 错误帧（以 {" 开头）不解压。
  if (payload.length > 10 && payload[0] === 0x7b && payload[1] === 0x22) {
    const text = Buffer.from(payload).toString('utf-8')
    if (text.startsWith('{"error"')) return payload
  }
  if (
    flags === COMPRESS_FLAG.GZIP ||
    flags === COMPRESS_FLAG.TRAILER ||
    flags === COMPRESS_FLAG.GZIP_TRAILER
  ) {
    const buf = Buffer.from(payload)
    try {
      return new Uint8Array(zlib.gunzipSync(buf))
    } catch {
      try {
        return new Uint8Array(zlib.inflateSync(buf))
      } catch {
        try {
          return new Uint8Array(zlib.inflateRawSync(buf))
        } catch {
          return payload
        }
      }
    }
  }
  return payload
}

interface FrameRead {
  status: 'ok' | 'skip' | 'done'
  payload?: Uint8Array
  offset?: number
}

function readCursorFrame(buffer: Uint8Array, offset: number): FrameRead {
  if (offset + 5 > buffer.length) return { status: 'done' }
  const flags = buffer[offset]
  const length = (buffer[offset + 1] << 24) | (buffer[offset + 2] << 16) | (buffer[offset + 3] << 8) | buffer[offset + 4]
  if (offset + 5 + length > buffer.length) return { status: 'done' }
  const raw = buffer.slice(offset + 5, offset + 5 + length)
  const newOffset = offset + 5 + length
  const payload = decompressPayload(raw, flags)
  return { status: 'ok', payload, offset: newOffset }
}

/** 逐帧解析整包字节 → 累积文本/思考/工具调用；遇错误帧提前返回 fault。 */
function parseCursorBuffer(buffer: Uint8Array): ParsedCursor {
  let text = ''
  let thinking = ''
  const toolMap = new Map<string, { id: string; name: string; args: string }>()
  const toolOrder: string[] = []
  let offset = 0

  while (offset < buffer.length) {
    const frame = readCursorFrame(buffer, offset)
    if (frame.status === 'done') break
    offset = frame.offset!
    if (frame.status === 'skip' || frame.payload === undefined) continue
    const payload = frame.payload

    // JSON 错误帧（以 { 开头且含 "error"）。
    if (payload.length > 0 && payload[0] === 0x7b) {
      const asText = Buffer.from(payload).toString('utf-8')
      if (asText.includes('"error"')) {
        const hasContent = text.length > 0 || toolMap.size > 0
        if (hasContent) break // 已有内容：截断收尾，不当错误。
        return { text, thinking, toolCalls: [], fault: parseJsonError(asText) }
      }
    }

    const result = extractTextFromResponse(new Uint8Array(payload))

    if (result.toolCall) {
      const tc = result.toolCall
      const existing = toolMap.get(tc.id)
      if (existing) {
        existing.args += tc.function.arguments
      } else {
        toolMap.set(tc.id, { id: tc.id, name: tc.function.name, args: tc.function.arguments })
        toolOrder.push(tc.id)
      }
    }
    if (result.text) text += result.text
    if (result.thinking) thinking += result.thinking
  }

  const toolCalls = toolOrder.map((id) => toolMap.get(id)!)
  return { text, thinking, toolCalls }
}

function parseJsonError(jsonText: string): CursorUpstreamFault {
  try {
    const obj = JSON.parse(jsonText) as {
      error?: {
        code?: string
        message?: string
        details?: Array<{ debug?: { error?: string; details?: { title?: string; detail?: string } } }>
      }
    }
    const debug = obj.error?.details?.[0]?.debug
    const msg = debug?.details?.title || debug?.details?.detail || obj.error?.message || 'Cursor API error'
    const code = obj.error?.code
    const unauthenticated = code === 'unauthenticated' || debug?.error === 'ERROR_NOT_LOGGED_IN'
    return { message: msg, rateLimited: code === 'resource_exhausted', unauthenticated }
  } catch {
    return { message: 'Cursor API error', rateLimited: false, unauthenticated: false }
  }
}

/** composer 模型：thinking 末尾 </think> 之后是可见正文。 */
function visibleComposerContent(thinking: string): string {
  const endTag = '</think>'
  const idx = thinking.lastIndexOf(endTag)
  if (idx < 0) return ''
  return thinking.slice(idx + endTag.length).trimStart()
}

function estimateUsage(model: string, request: CanonicalRequest, outputText: string): Usage {
  const outputTokens = outputText.length > 0 ? countTextTokens(outputText) : 0
  return { inputTokens: estimateRequestInputTokens(request), outputTokens }
}

/** 非流式：整包 → CanonicalResponse。fault 时抛（由上层 classifyError 决策）。 */
export function foldCursorResponse(
  buffer: Uint8Array,
  model: string,
  request: CanonicalRequest,
): { response?: CanonicalResponse; fault?: CursorUpstreamFault } {
  const parsed = parseCursorBuffer(buffer)
  if (parsed.fault) return { fault: parsed.fault }

  const content: ContentBlock[] = []
  let outputChars = parsed.text + parsed.thinking
  const visibleText =
    parsed.text.length > 0 ? parsed.text : isComposerModel(model) ? visibleComposerContent(parsed.thinking) : ''

  if (parsed.thinking.length > 0) content.push({ type: 'thinking', text: parsed.thinking })
  if (visibleText.length > 0) content.push({ type: 'text', text: visibleText })
  for (const tc of parsed.toolCalls) {
    content.push({ type: 'tool_use', id: tc.id, name: tc.name, input: safeJson(tc.args) })
    outputChars += tc.args
  }

  const stopReason: StopReason = parsed.toolCalls.length > 0 ? 'tool_use' : 'end_turn'
  return {
    response: { model, content, stopReason, usage: estimateUsage(model, request, outputChars) },
  }
}

/** 流式（缓冲式）：整包 → CanonicalStreamEvent 序列（含末尾 usage + message_stop）。 */
export function streamCursorResponse(
  buffer: Uint8Array,
  model: string,
  request: CanonicalRequest,
): { events?: CanonicalStreamEvent[]; fault?: CursorUpstreamFault } {
  const parsed = parseCursorBuffer(buffer)
  if (parsed.fault) return { fault: parsed.fault }

  const events: CanonicalStreamEvent[] = []
  let outputChars = parsed.text + parsed.thinking

  if (parsed.thinking.length > 0) events.push({ type: 'thinking_delta', text: parsed.thinking })
  const visibleText =
    parsed.text.length > 0 ? parsed.text : isComposerModel(model) ? visibleComposerContent(parsed.thinking) : ''
  if (visibleText.length > 0) events.push({ type: 'text_delta', text: visibleText })

  parsed.toolCalls.forEach((tc, index) => {
    events.push({ type: 'tool_use_start', index, id: tc.id, name: tc.name })
    if (tc.args.length > 0) events.push({ type: 'tool_use_delta', index, partialJson: tc.args })
    outputChars += tc.args
  })

  events.push({ type: 'usage', usage: estimateUsage(model, request, outputChars) })
  events.push({ type: 'message_stop', stopReason: parsed.toolCalls.length > 0 ? 'tool_use' : 'end_turn' })
  return { events }
}

function safeJson(s: string): Record<string, unknown> {
  if (s.length === 0) return {}
  try {
    const parsed = JSON.parse(s)
    return parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed }
  } catch {
    return { _error: 'tool input parse failed', _partial: s.slice(0, 500) }
  }
}
