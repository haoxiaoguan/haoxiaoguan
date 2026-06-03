/**
 * Phase 2 出站惰性化关键行为测试。
 *
 * 覆盖：
 * 1. 首事件错误边界（核心）：peek 到第一个 next() 就 throw → 转 ApiProxyHttpError 429
 * 2. 首字节后错误（对比边界）：先 yield 再 throw → handleRequest 不抛，但 for-await frames 中途 throw
 * 3. Anthropic input 降级：message_start.input_tokens === estimateRequestInputTokens(ir)，且无 cache 字段
 * 4. 端到端惰性（非 service 内 drain）：OpenAI 流式首帧就绪时 source 未全部被拉完
 * 5. Gemini/Responses drain 语义保留：Gemini frames 完整、Responses store.save 被调用
 */
import { describe, it, expect, vi } from 'vitest'
import { ApiProxyService, ApiProxyHttpError } from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { EchoUpstreamAdapter } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/echo/echo-adapter'
import { KiroUpstreamError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/kiro/kiro-upstream-client'
import { anthropicToIR } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/anthropic'
import { estimateRequestInputTokens } from '../../../src/main/contexts/apiProxy/domain/usage/token-estimator'
import { serializeGeminiStream } from '../../../src/main/contexts/apiProxy/infrastructure/inbound/gemini'
import type { PlatformUpstreamAdapter, UpstreamCtx, ModelInfo, ErrorClass } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../src/main/contexts/apiProxy/domain/canonical'
import type { RequestIntent } from '../../../src/main/contexts/apiProxy/domain/request-intent'
import type { ResponsesStore, StoredResponseDoc } from '../../../src/main/contexts/apiProxy/infrastructure/responses-store/responses-store'

// ─── 辅助：收集 AsyncIterable<string> 所有帧 ───
async function collectFrames(frames: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const f of frames) out.push(f)
  return out
}

// ─── 辅助：构造 mock adapter，chatStream 完全由外部 gen 决定 ───
function makeMockAdapter(
  gen: (ir: CanonicalRequest, ctx: UpstreamCtx) => AsyncIterable<CanonicalStreamEvent>,
): PlatformUpstreamAdapter {
  return {
    platform: 'mock',
    supportsModel: () => true,
    classifyError: (): ErrorClass => 'TRANSIENT',
    listModels: (): ModelInfo[] => [{ id: 'mock-model' }],
    async chat(_ir: CanonicalRequest, _ctx: UpstreamCtx): Promise<CanonicalResponse> {
      return { model: 'mock-model', content: [], stopReason: 'end_turn', usage: { inputTokens: 1, outputTokens: 1 } }
    },
    chatStream: gen,
  }
}

// ─── 辅助：构造 ApiProxyService，使用 mock adapter ───
function makeServiceWith(adapter: PlatformUpstreamAdapter): ApiProxyService {
  const registry = new PlatformRegistry()
  registry.register(adapter)
  return new ApiProxyService(undefined, { registry })
}

// ─── 辅助：构造带 mock ResponsesStore 的 service ───
function makeServiceWithStore(adapter: PlatformUpstreamAdapter): {
  svc: ApiProxyService
  saveMock: ReturnType<typeof vi.fn>
} {
  const registry = new PlatformRegistry()
  registry.register(adapter)

  const saveMock = vi.fn()
  const mockStore: ResponsesStore = {
    save: saveMock as (doc: StoredResponseDoc) => void,
    load: (_id: string) => undefined,
    generateResponseId: () => 'resp_test123',
    generateItemId: (i: number) => `item_${i}`,
  }
  const svc = new ApiProxyService(undefined, { registry, responsesStore: mockStore })
  return { svc, saveMock }
}

// ══════════════════════════════════════════════
// 测试 1：首事件错误边界（核心）
// ══════════════════════════════════════════════
describe('Phase2 惰性化 — 首事件错误边界', () => {
  it('adapter.chatStream 第一个 next() 即 throw KiroUpstreamError(429) → handleRequest reject ApiProxyHttpError status=429', async () => {
    // 构造一个第一次 next() 就抛 429 的 async generator
    const adapter = makeMockAdapter(async function* () {
      throw new KiroUpstreamError('rate limited', 429)
      // 注：yield 在 throw 前不会执行，TS 需要一个 yield 使函数成为 generator
      yield { type: 'text_delta', text: '' } as CanonicalStreamEvent
    })
    const svc = makeServiceWith(adapter)

    const intent: RequestIntent = { format: 'openai', action: 'chat', model: 'mock-model', stream: true }
    await expect(
      svc.handleRequest({
        intent,
        body: { model: 'mock-model', stream: true, messages: [{ role: 'user', content: 'hello' }] },
        requestId: 'err-first',
      }),
    ).rejects.toSatisfy((e: unknown) => {
      return e instanceof ApiProxyHttpError && e.status === 429
    })
  })

  it('首事件错误抛出的 ApiProxyHttpError 的 name 为 ApiProxyHttpError', async () => {
    const adapter = makeMockAdapter(async function* () {
      throw new KiroUpstreamError('rate limited', 429)
      yield { type: 'text_delta', text: '' } as CanonicalStreamEvent
    })
    const svc = makeServiceWith(adapter)

    const intent: RequestIntent = { format: 'anthropic', action: 'messages', model: 'mock-model', stream: true }
    const err = await svc
      .handleRequest({
        intent,
        body: { model: 'mock-model', stream: true, max_tokens: 16, messages: [{ role: 'user', content: 'hi' }] },
        requestId: 'err-name',
      })
      .catch((e: unknown) => e)
    expect(err).toBeInstanceOf(ApiProxyHttpError)
    expect((err as ApiProxyHttpError).name).toBe('ApiProxyHttpError')
  })
})

// ══════════════════════════════════════════════
// 测试 2：首字节后错误（对比边界）
// ══════════════════════════════════════════════
describe('Phase2 惰性化 — 首字节后错误（对比边界）', () => {
  it('先 yield text_delta 再 throw → handleRequest 不抛，返回 StreamResult；for-await frames 中途 throw', async () => {
    // 先发一个合法事件，再抛错
    const adapter = makeMockAdapter(async function* () {
      yield { type: 'text_delta', text: 'partial' } as CanonicalStreamEvent
      throw new KiroUpstreamError('mid-stream failure', 503)
    })
    const svc = makeServiceWith(adapter)

    const intent: RequestIntent = { format: 'openai', action: 'chat', model: 'mock-model', stream: true }
    // handleRequest 本身不应 throw（peek 已消费首字节成功，HTTP 头已确定）
    const result = await svc.handleRequest({
      intent,
      body: { model: 'mock-model', stream: true, messages: [{ role: 'user', content: 'hi' }] },
      requestId: 'mid-err',
    })
    expect(result.kind).toBe('stream')

    // 但 for-await frames 时会在中途 throw
    const frames = (result as { frames: AsyncIterable<string> }).frames
    await expect(collectFrames(frames)).rejects.toThrow()
  })
})

// ══════════════════════════════════════════════
// 测试 3：Anthropic input 降级
// ══════════════════════════════════════════════
describe('Phase2 惰性化 — Anthropic message_start input 降级', () => {
  it('message_start.usage.input_tokens === estimateRequestInputTokens(ir)（同款 ir 对比）', async () => {
    // 使用 Echo 适配器（chatStream 有确定性输出）
    const registry = new PlatformRegistry()
    registry.register(new EchoUpstreamAdapter())
    const svc = new ApiProxyService(undefined, { registry })

    const reqBody = {
      model: 'echo-1',
      stream: true,
      max_tokens: 32,
      messages: [{ role: 'user' as const, content: 'hello world' }],
    }
    const intent: RequestIntent = { format: 'anthropic', action: 'messages', model: 'echo-1', stream: true }

    const result = await svc.handleRequest({ intent, body: reqBody, requestId: 'ant-input' })
    expect(result.kind).toBe('stream')

    const frames = await collectFrames((result as { frames: AsyncIterable<string> }).frames)

    // 找 message_start 帧
    const startFrame = frames.find((f) => f.includes('message_start'))
    expect(startFrame).toBeDefined()

    const startData = JSON.parse(startFrame!.split('\ndata: ')[1]) as {
      message: { usage: { input_tokens: number; cache_read_input_tokens?: unknown; cache_creation_input_tokens?: unknown } }
    }

    // 用同款 ir 自己算一遍对比
    const ir = anthropicToIR(reqBody)
    const expectedInputTokens = estimateRequestInputTokens(ir)

    expect(startData.message.usage.input_tokens).toBe(expectedInputTokens)
    // 惰性降级：无 cache 字段
    expect(startData.message.usage.cache_read_input_tokens).toBeUndefined()
    expect(startData.message.usage.cache_creation_input_tokens).toBeUndefined()
  })
})

// ══════════════════════════════════════════════
// 测试 4：端到端惰性（非 service 内 drain）
// ══════════════════════════════════════════════
describe('Phase2 惰性化 — OpenAI 端到端惰性（service 不 drain）', () => {
  it('取 result.frames 的首帧时，source adapter 未把所有事件全部拉完', async () => {
    // 构造「可观测拉取进度」的 mock adapter（每 yield 一个事件记 pulled++）
    let pulled = 0
    const totalEvents = 5
    const adapter = makeMockAdapter(async function* () {
      for (let i = 0; i < totalEvents; i++) {
        pulled++
        if (i < totalEvents - 2) {
          yield { type: 'text_delta', text: `tok${i}` } as CanonicalStreamEvent
        } else if (i === totalEvents - 2) {
          yield { type: 'usage', usage: { inputTokens: 10, outputTokens: 5 } } as CanonicalStreamEvent
        } else {
          yield { type: 'message_stop', stopReason: 'end_turn' } as CanonicalStreamEvent
        }
      }
    })
    const svc = makeServiceWith(adapter)

    const intent: RequestIntent = { format: 'openai', action: 'chat', model: 'mock-model', stream: true }
    const result = await svc.handleRequest({
      intent,
      body: { model: 'mock-model', stream: true, messages: [{ role: 'user', content: 'test' }] },
      requestId: 'lazy-test',
    })
    expect(result.kind).toBe('stream')

    // 取首帧（OpenAI 惰性版首帧是 role:assistant，在 for-await events 前 yield）
    const framesIt = (result as { frames: AsyncIterable<string> }).frames[Symbol.asyncIterator]()
    const firstFrame = await framesIt.next()
    expect(firstFrame.done).toBe(false)
    expect(firstFrame.value).toContain('"role":"assistant"')

    // 此时 source adapter 尚未拉完所有事件（服务没有提前 drain）
    // 首帧在 for-await events 之前 yield，因此 pulled 此时应 < totalEvents
    expect(pulled).toBeLessThan(totalEvents)

    // 清尾（避免 generator 悬空）
    while (!(await framesIt.next()).done) { /* drain */ }
  })
})

// ══════════════════════════════════════════════
// 测试 5：Gemini drain 语义保留 + Responses store.save 被调用
// ══════════════════════════════════════════════
describe('Phase2 惰性化 — Gemini/Responses drain 语义保留', () => {
  it('Gemini 流式：frames === serializeGeminiStream(全事件)（drain 后包装，帧完整）', async () => {
    // 固定事件序列
    const echoText = 'gemini-drain-test'
    const fixedEvents: CanonicalStreamEvent[] = [
      { type: 'text_delta', text: echoText },
      { type: 'usage', usage: { inputTokens: 3, outputTokens: 4 } },
      { type: 'message_stop', stopReason: 'end_turn' },
    ]

    const adapter = makeMockAdapter(async function* () {
      for (const ev of fixedEvents) yield ev
    })
    const registry = new PlatformRegistry()
    registry.register(adapter)
    // Gemini 需要 gemini serializeStream：使用真实的 serializeGeminiStream
    const svc = new ApiProxyService(undefined, { registry })

    const intent: RequestIntent = { format: 'gemini', action: 'generateContent', model: 'mock-model', stream: true }
    const result = await svc.handleRequest({
      intent,
      body: { contents: [{ role: 'user', parts: [{ text: echoText }] }] },
      requestId: 'gemini-drain',
    })
    expect(result.kind).toBe('stream')
    expect((result as { contentType: string }).contentType).toBe('application/json')

    const frames = await collectFrames((result as { frames: AsyncIterable<string> }).frames)

    // 用同款事件跑 serializeGeminiStream，比对
    const expected = serializeGeminiStream(fixedEvents)
    expect(frames).toEqual(expected)
  })

  it('Responses 流式：store.save 被调用（drain + 落盘仍发生）', async () => {
    // Echo 适配器 chatStream 有确定性输出，用于 Responses 路径 drain
    const echoAdapter = new EchoUpstreamAdapter()
    const { svc, saveMock } = makeServiceWithStore(echoAdapter)

    const intent: RequestIntent = {
      platform: 'echo',
      format: 'openai-responses',
      action: 'responses',
      model: 'echo-1',
      stream: true,
    }
    const result = await svc.handleRequest({
      intent,
      body: { model: 'echo-1', input: 'drain-test', store: true, stream: true },
      requestId: 'resp-drain',
    })
    expect(result.kind).toBe('stream')

    // 消费 frames（Responses 在 handleRequest 内已 drain，frames 是预计算的）
    await collectFrames((result as { frames: AsyncIterable<string> }).frames)

    // store.save 必须已被调用（drain + 落盘语义）
    expect(saveMock).toHaveBeenCalledOnce()
    const savedDoc = saveMock.mock.calls[0][0] as StoredResponseDoc
    expect(savedDoc.id).toBe('resp_test123')
    expect(savedDoc.status).toBe('completed')
  })
})
