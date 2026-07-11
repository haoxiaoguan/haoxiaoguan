import { describe, it, expect } from 'vitest'
import {
  encodeVarint,
  decodeVarint,
  encodeField,
  decodeMessage,
  wrapConnectRPCFrame,
  parseConnectRPCFrame,
  extractTextFromResponse,
  generateCursorBody,
  type CursorInputMessage,
  type CursorEncodeDeps,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/cursor/cursor-protobuf'

const LEN = 2
const VARINT = 0

function concat(...arrs: Uint8Array[]): Uint8Array {
  return new Uint8Array(Buffer.concat(arrs.map((a) => Buffer.from(a))))
}

// 确定性注入：递增 id + 固定时钟。
function fixedDeps(): CursorEncodeDeps {
  let n = 0
  return { genId: () => `id-${n++}`, now: () => 1_700_000_000_000 }
}

describe('cursor-protobuf: varint', () => {
  it('round-trips small and multi-byte values', () => {
    for (const v of [0, 1, 127, 128, 300, 16384, 2097151, 123456789]) {
      const [decoded, pos] = decodeVarint(encodeVarint(v), 0)
      expect(decoded).toBe(v)
      expect(pos).toBe(encodeVarint(v).length)
    }
  })
})

describe('cursor-protobuf: Connect-RPC frame', () => {
  it('wraps + parses an uncompressed frame (5-byte big-endian header)', () => {
    const payload = new Uint8Array([1, 2, 3, 4, 5, 6, 7])
    const frame = wrapConnectRPCFrame(payload, false)
    expect(frame[0]).toBe(0x00) // flags: no compression
    expect(frame.length).toBe(5 + payload.length)
    // big-endian length
    expect((frame[1] << 24) | (frame[2] << 16) | (frame[3] << 8) | frame[4]).toBe(payload.length)

    const parsed = parseConnectRPCFrame(frame)
    expect(parsed).not.toBeNull()
    expect(Array.from(parsed!.payload)).toEqual(Array.from(payload))
    expect(parsed!.consumed).toBe(frame.length)
  })

  it('wraps + parses a gzip-compressed frame (flags=0x01)', () => {
    const payload = new Uint8Array(Buffer.from('the quick brown fox '.repeat(20)))
    const frame = wrapConnectRPCFrame(payload, true)
    expect(frame[0]).toBe(0x01)
    const parsed = parseConnectRPCFrame(frame)
    expect(parsed).not.toBeNull()
    expect(Array.from(parsed!.payload)).toEqual(Array.from(payload))
  })

  it('returns null for an incomplete frame', () => {
    expect(parseConnectRPCFrame(new Uint8Array([0, 0, 0]))).toBeNull()
    // header claims 100 bytes but body is short
    expect(parseConnectRPCFrame(new Uint8Array([0, 0, 0, 0, 100, 1, 2]))).toBeNull()
  })
})

describe('cursor-protobuf: response extraction', () => {
  it('extracts plain assistant text (field 2 → nested field 1)', () => {
    const payload = encodeField(2, LEN, encodeField(1, LEN, 'hello world'))
    const r = extractTextFromResponse(payload)
    expect(r.text).toBe('hello world')
    expect(r.toolCall).toBeNull()
    expect(r.thinking).toBeNull()
    expect(r.error).toBeNull()
  })

  it('extracts thinking (field 2 → nested field 25 → nested field 1)', () => {
    const thinkingInner = encodeField(1, LEN, 'let me reason')
    const responseInner = encodeField(25, LEN, thinkingInner)
    const payload = encodeField(2, LEN, responseInner)
    const r = extractTextFromResponse(payload)
    expect(r.thinking).toBe('let me reason')
    expect(r.text).toBeNull()
  })

  it('extracts a tool call (field 1 → id/name/raw_args/is_last)', () => {
    const toolInner = concat(
      encodeField(3, LEN, 'call-abc'), // TOOL_ID
      encodeField(9, LEN, 'Write'), // TOOL_NAME
      encodeField(10, LEN, '{"path":"/x"}'), // TOOL_RAW_ARGS
      encodeField(11, VARINT, 1), // TOOL_IS_LAST
    )
    const payload = encodeField(1, LEN, toolInner)
    const r = extractTextFromResponse(payload)
    expect(r.toolCall).not.toBeNull()
    expect(r.toolCall!.id).toBe('call-abc')
    expect(r.toolCall!.function.name).toBe('Write')
    expect(r.toolCall!.function.arguments).toBe('{"path":"/x"}')
    expect(r.toolCall!.isLast).toBe(true)
  })

  it('takes the first line of a multi-line tool id', () => {
    const toolInner = concat(
      encodeField(3, LEN, 'call-xyz\nmc_model-1'),
      encodeField(9, LEN, 'Read'),
      encodeField(10, LEN, '{}'),
    )
    const r = extractTextFromResponse(encodeField(1, LEN, toolInner))
    expect(r.toolCall!.id).toBe('call-xyz')
  })

  it('returns empty (no throw) on undecodable payload', () => {
    const r = extractTextFromResponse(new Uint8Array([0xff, 0xff, 0xff]))
    expect(r.text).toBeNull()
    expect(r.toolCall).toBeNull()
  })
})

describe('cursor-protobuf: request encoding', () => {
  const messages: CursorInputMessage[] = [
    { role: 'user', content: 'hi there' },
  ]

  it('is deterministic under injected id/clock', () => {
    const a = generateCursorBody(messages, 'claude-4.5-sonnet', [], null, false, fixedDeps())
    const b = generateCursorBody(messages, 'claude-4.5-sonnet', [], null, false, fixedDeps())
    expect(Buffer.from(a).toString('hex')).toBe(Buffer.from(b).toString('hex'))
  })

  it('produces a valid frame whose inner protobuf carries REQUEST→MESSAGES+MODEL', () => {
    const body = generateCursorBody(messages, 'claude-4.5-sonnet', [], null, false, fixedDeps())
    const parsed = parseConnectRPCFrame(body)
    expect(parsed).not.toBeNull()

    const top = decodeMessage(parsed!.payload)
    // top-level field 1 = REQUEST (StreamUnifiedChatRequestWithTools)
    expect(top.has(1)).toBe(true)

    const request = decodeMessage(top.get(1)![0].value as Uint8Array)
    // field 1 = MESSAGES, field 5 = MODEL
    expect(request.has(1)).toBe(true)
    expect(request.has(5)).toBe(true)

    // MODEL nested field 1 = MODEL_NAME
    const model = decodeMessage(request.get(5)![0].value as Uint8Array)
    const modelName = Buffer.from(model.get(1)![0].value as Uint8Array).toString('utf8')
    expect(modelName).toBe('claude-4.5-sonnet')
  })

  it('flags agentic mode when tools are present', () => {
    const tools = [{ function: { name: 'Write', description: 'writes', parameters: { type: 'object' } } }]
    const body = generateCursorBody(messages, 'claude-4.5-sonnet', tools, null, false, fixedDeps())
    const parsed = parseConnectRPCFrame(body)!
    const request = decodeMessage(decodeMessage(parsed.payload).get(1)![0].value as Uint8Array)
    // field 27 = IS_AGENTIC (varint 1), field 34 = MCP_TOOLS present
    expect(request.get(27)![0].value).toBe(1)
    expect(request.has(34)).toBe(true)
    // UNIFIED_MODE_NAME (field 54) = "Agent"
    const modeName = Buffer.from(request.get(54)![0].value as Uint8Array).toString('utf8')
    expect(modeName).toBe('Agent')
  })

  it('uses non-agentic "Ask" mode without tools', () => {
    const body = generateCursorBody(messages, 'claude-4.5-sonnet', [], null, false, fixedDeps())
    const parsed = parseConnectRPCFrame(body)!
    const request = decodeMessage(decodeMessage(parsed.payload).get(1)![0].value as Uint8Array)
    expect(request.get(27)![0].value).toBe(0)
    const modeName = Buffer.from(request.get(54)![0].value as Uint8Array).toString('utf8')
    expect(modeName).toBe('Ask')
  })
})
