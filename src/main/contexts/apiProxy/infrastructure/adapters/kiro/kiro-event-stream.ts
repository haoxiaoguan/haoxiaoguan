// AWS vnd.amazon.eventstream 帧解析（纯函数）。把 CodeWhisperer 流式响应字节解成 CanonicalStreamEvent[]。
// 帧布局：4B 总长(BE) | 4B 头长(BE) | 4B prelude CRC | headers | JSON payload | 4B msg CRC。
// header 项：1B nameLen | name | 1B valueType | value（valueType=7 为 string：2B len | bytes）。
// AWS event-stream 帧解析 / event-type 提取（按线协议实现，不含 token 估算/UI 事件）。
import type { CanonicalStreamEvent, StopReason, Usage } from '../../../domain/canonical'

const PRELUDE_BYTES = 12 // 4B 总长 + 4B 头长 + 4B prelude CRC
const MSG_CRC_BYTES = 4

const decoder = new TextDecoder()

// 各 valueType 的固定值宽度（字节）；6/7 为变长（带长度前缀），单独处理。
const FIXED_VALUE_WIDTH: Record<number, number> = { 0: 0, 1: 0, 2: 1, 3: 2, 4: 4, 5: 8, 8: 8, 9: 16 }

/**
 * 从 header 块取 :event-type 字符串。遍历每项；命中即返回，越界即返回 ''。
 */
export function extractEventType(headers: Uint8Array): string {
  let offset = 0
  while (offset < headers.length) {
    const nameLen = headers[offset]
    offset += 1
    if (offset + nameLen > headers.length) break
    const name = decoder.decode(headers.subarray(offset, offset + nameLen))
    offset += nameLen
    if (offset >= headers.length) break
    const valueType = headers[offset]
    offset += 1

    if (valueType === 7) {
      // string：2B 长度 + bytes
      if (offset + 2 > headers.length) break
      const valueLen = (headers[offset] << 8) | headers[offset + 1]
      offset += 2
      if (offset + valueLen > headers.length) break
      const value = decoder.decode(headers.subarray(offset, offset + valueLen))
      offset += valueLen
      if (name === ':event-type') return value
      continue
    }
    if (valueType === 6) {
      // byte buffer：2B 长度 + bytes（跳过）
      if (offset + 2 > headers.length) break
      const len = (headers[offset] << 8) | headers[offset + 1]
      offset += 2 + len
      continue
    }
    const width = FIXED_VALUE_WIDTH[valueType]
    if (width === undefined) break
    offset += width
  }
  return ''
}

// 工具累积状态：跨多帧拼一个 toolUse。
interface ToolAccum {
  id: string
  index: number
}

// 从 payload 对象里按「:event-type 名」或「内嵌同名 key」取事件体。
function pickEventBody(eventType: string, payload: Record<string, unknown>): Record<string, unknown> {
  const nested = payload[eventType]
  if (nested !== null && typeof nested === 'object') return nested as Record<string, unknown>
  return payload
}

// 解析 messageMetadataEvent.tokenUsage → Usage 片段（累加 cache 到 inputTokens）。
function parseUsage(body: Record<string, unknown>): Partial<Usage> {
  const tu = body.tokenUsage
  if (tu === null || typeof tu !== 'object') return {}
  const t = tu as Record<string, unknown>
  const num = (v: unknown): number => (typeof v === 'number' && Number.isFinite(v) ? v : 0)
  const uncached = num(t.uncachedInputTokens)
  const cacheRead = num(t.cacheReadInputTokens)
  const cacheWrite = num(t.cacheWriteInputTokens)
  const out: Partial<Usage> = {
    inputTokens: uncached + cacheRead + cacheWrite,
    outputTokens: num(t.outputTokens),
  }
  if (cacheRead > 0) out.cacheReadTokens = cacheRead
  if (cacheWrite > 0) out.cacheWriteTokens = cacheWrite
  return out
}

/** 有状态增量解析器接口。push 喂字节（返回本批完整帧解出的 delta 事件），flush 流末收口。 */
export interface KiroEventStreamParser {
  push(chunk: Uint8Array): CanonicalStreamEvent[]
  flush(): CanonicalStreamEvent[]
}

/**
 * 创建有状态的增量 AWS event-stream 解析器。
 * push(chunk) 喂入任意分片字节，返回本批已完整帧解出的 text/thinking/tool delta 事件；
 * usage 类元信息只累积进内部 state，push 阶段不 emit。
 * flush() 在流末调用：收口未闭合 tool，返回 usage 事件 + message_stop。
 */
export function createKiroEventStreamParser(): KiroEventStreamParser {
  let buffer = new Uint8Array(0)
  const usage: Usage = { inputTokens: 0, outputTokens: 0 }
  let sawToolUse = false
  let contextUsagePercentage: number | undefined
  let tool: ToolAccum | null = null
  let nextToolIndex = 0

  const closeTool = (): void => {
    tool = null
  }

  function push(chunk: Uint8Array): CanonicalStreamEvent[] {
    // concat buffer + chunk
    const merged = new Uint8Array(buffer.length + chunk.length)
    merged.set(buffer)
    merged.set(chunk, buffer.length)
    buffer = merged

    const out: CanonicalStreamEvent[] = []
    const bytes = buffer
    const dv = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength)
    let pos = 0

    while (bytes.length - pos >= PRELUDE_BYTES) {
      const totalLen = dv.getUint32(pos, false)
      if (totalLen < PRELUDE_BYTES + MSG_CRC_BYTES || bytes.length - pos < totalLen) break
      const headersLen = dv.getUint32(pos + 4, false)
      const headersStart = pos + PRELUDE_BYTES
      const headersEnd = headersStart + headersLen
      const payloadStart = headersEnd
      const payloadEnd = pos + totalLen - MSG_CRC_BYTES
      if (headersEnd > bytes.length || payloadEnd > bytes.length || payloadStart > payloadEnd) break

      const eventType = extractEventType(bytes.subarray(headersStart, headersEnd))
      const payloadBytes = bytes.subarray(payloadStart, payloadEnd)

      if (payloadBytes.length > 0) {
        let payload: unknown
        try {
          payload = JSON.parse(decoder.decode(payloadBytes))
        } catch {
          payload = undefined
        }
        if (payload !== null && typeof payload === 'object') {
          const obj = payload as Record<string, unknown>
          const body = pickEventBody(eventType, obj)

          if (eventType === 'assistantResponseEvent' || eventType === 'codeEvent') {
            const content = body.content
            if (typeof content === 'string' && content.length > 0) {
              closeTool()
              out.push({ type: 'text_delta', text: content })
            }
          } else if (eventType === 'reasoningContentEvent') {
            const text = body.text
            if (typeof text === 'string' && text.length > 0) {
              closeTool()
              out.push({ type: 'thinking_delta', text })
            }
          } else if (eventType === 'toolUseEvent') {
            const toolUseId = typeof body.toolUseId === 'string' ? body.toolUseId : undefined
            const name = typeof body.name === 'string' ? body.name : undefined
            const stop = body.stop === true
            const input = body.input

            if (toolUseId !== undefined && (tool === null || tool.id !== toolUseId)) {
              if (tool !== null) closeTool()
              if (name !== undefined) {
                tool = { id: toolUseId, index: nextToolIndex++ }
                sawToolUse = true
                out.push({ type: 'tool_use_start', index: tool.index, id: toolUseId, name })
              }
            }
            if (tool !== null) {
              if (typeof input === 'string' && input.length > 0) {
                out.push({ type: 'tool_use_delta', index: tool.index, partialJson: input })
              } else if (input !== null && typeof input === 'object') {
                out.push({ type: 'tool_use_delta', index: tool.index, partialJson: JSON.stringify(input) })
              }
              if (stop) closeTool()
            }
          } else if (eventType === 'messageMetadataEvent') {
            const u = parseUsage(body)
            if (u.inputTokens !== undefined) usage.inputTokens = u.inputTokens
            if (u.outputTokens !== undefined) usage.outputTokens = u.outputTokens
            if (u.cacheReadTokens !== undefined) usage.cacheReadTokens = u.cacheReadTokens
            if (u.cacheWriteTokens !== undefined) usage.cacheWriteTokens = u.cacheWriteTokens
          } else if (eventType === 'contextUsageEvent') {
            const pct = body.contextUsagePercentage
            if (typeof pct === 'number' && Number.isFinite(pct)) contextUsagePercentage = pct
          }
          // 其它 event-type 忽略。
        }
      }

      pos += totalLen
    }

    // 保留未消费的半帧字节
    buffer = buffer.subarray(pos)
    return out
  }

  function flush(): CanonicalStreamEvent[] {
    closeTool()
    const stopReason: StopReason = sawToolUse ? 'tool_use' : 'end_turn'
    return [
      { type: 'usage', usage, ...(contextUsagePercentage !== undefined ? { contextUsagePercentage } : {}) },
      { type: 'message_stop', stopReason },
    ]
  }

  return { push, flush }
}

/**
 * 解析整段 AWS event-stream 字节为 IR 流事件序列。
 * 流末固定补一次 usage 事件 + 一次 message_stop（stopReason：出现过完成的 toolUse → 'tool_use'，否则 'end_turn'）。
 */
export function parseKiroEventStream(bytes: Uint8Array): CanonicalStreamEvent[] {
  const p = createKiroEventStreamParser()
  return [...p.push(bytes), ...p.flush()]
}

/**
 * 测试辅助：把 {eventType, payload} 列表编码成合法 AWS event-stream 字节。
 * 与 parseKiroEventStream 帧布局对称；prelude/msg CRC 用 0 占位（解析端不校验）。
 * 仅供单测构造样本；生产链路不调用。
 */
export function encodeKiroEventStream(
  list: { eventType: string; payload: unknown }[],
): Uint8Array {
  const enc = new TextEncoder()
  const chunks: Uint8Array[] = []
  for (const { eventType, payload } of list) {
    const nameBytes = enc.encode(':event-type')
    const typeBytes = enc.encode(eventType)
    const headerLen = 1 + nameBytes.length + 1 + 2 + typeBytes.length
    const headers = new Uint8Array(headerLen)
    let o = 0
    headers[o++] = nameBytes.length
    headers.set(nameBytes, o); o += nameBytes.length
    headers[o++] = 7 // string value type
    headers[o++] = (typeBytes.length >> 8) & 0xff
    headers[o++] = typeBytes.length & 0xff
    headers.set(typeBytes, o); o += typeBytes.length

    const payloadBytes = enc.encode(JSON.stringify(payload))
    const total = PRELUDE_BYTES + headerLen + payloadBytes.length + MSG_CRC_BYTES
    const buf = new Uint8Array(total)
    const dv = new DataView(buf.buffer)
    dv.setUint32(0, total, false)
    dv.setUint32(4, headerLen, false)
    dv.setUint32(8, 0, false) // prelude CRC 占位
    buf.set(headers, PRELUDE_BYTES)
    buf.set(payloadBytes, PRELUDE_BYTES + headerLen)
    dv.setUint32(total - MSG_CRC_BYTES, 0, false) // msg CRC 占位
    chunks.push(buf)
  }
  const totalLen = chunks.reduce((n, c) => n + c.length, 0)
  const result = new Uint8Array(totalLen)
  let pos = 0
  for (const c of chunks) {
    result.set(c, pos)
    pos += c.length
  }
  return result
}
