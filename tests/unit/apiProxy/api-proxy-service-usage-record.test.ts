/**
 * 路由日志 token 记录修复测试。
 *
 * 覆盖两个根因修复：
 *  A. 流式请求：record 延迟到流末（消费 frames 前不记录），输出/缓存 token 由 usage 事件旁路回填。
 *  B. responses 透传（codex-native / 第三方）：平台归属 + 从透传 SSE 解析 usage 回填。
 *  并对 usage 解析纯函数（口径拆分 / SSE 帧提取）做单测。
 */
import { describe, it, expect } from 'vitest'
import {
  ApiProxyService,
  responsesUsageToCapture,
  extractUsageFromSseFrame,
} from '../../../src/main/contexts/apiProxy/application/api-proxy-service'
import { PlatformRegistry } from '../../../src/main/contexts/apiProxy/infrastructure/platform-registry'
import { ProxyRequestLog } from '../../../src/main/contexts/apiProxy/domain/observability/proxy-request-log'
import type {
  PlatformUpstreamAdapter,
  UpstreamCtx,
  ModelInfo,
  ErrorClass,
} from '../../../src/main/contexts/apiProxy/domain/platform-adapter'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
} from '../../../src/main/contexts/apiProxy/domain/canonical'
import type { RequestIntent } from '../../../src/main/contexts/apiProxy/domain/request-intent'
import type { CodexNativePassthrough } from '../../../src/main/contexts/apiProxy/domain/codex-native-passthrough'

async function collectFrames(frames: AsyncIterable<string>): Promise<string[]> {
  const out: string[] = []
  for await (const f of frames) out.push(f)
  return out
}

function makeMockAdapter(
  gen: (ir: CanonicalRequest, ctx: UpstreamCtx) => AsyncIterable<CanonicalStreamEvent>,
): PlatformUpstreamAdapter {
  return {
    platform: 'mock',
    supportsModel: () => true,
    classifyError: (): ErrorClass => 'TRANSIENT',
    listModels: (): ModelInfo[] => [{ id: 'mock-model' }],
    async chat(): Promise<CanonicalResponse> {
      return {
        model: 'mock-model',
        content: [],
        stopReason: 'end_turn',
        usage: { inputTokens: 1, outputTokens: 1 },
      }
    },
    chatStream: gen,
  }
}

// ══════════════════════════════════════════════
// 修复 A：流式 record 延迟 + token 回填
// ══════════════════════════════════════════════
describe('流式 token 记录 — record 延迟到流末 + usage 旁路回填', () => {
  it('chat 流式：消费 frames 前不记录；流末记录带输出/缓存 token', async () => {
    const adapter = makeMockAdapter(async function* () {
      yield { type: 'text_delta', text: 'hi' } as CanonicalStreamEvent
      yield {
        type: 'usage',
        usage: { inputTokens: 10, outputTokens: 7, cacheReadTokens: 3 },
      } as CanonicalStreamEvent
      yield { type: 'message_stop', stopReason: 'end_turn' } as CanonicalStreamEvent
    })
    const registry = new PlatformRegistry()
    registry.register(adapter)
    const obs = new ProxyRequestLog()
    const svc = new ApiProxyService(undefined, { registry, observability: obs })

    const intent: RequestIntent = {
      format: 'openai',
      action: 'chat',
      model: 'mock-model',
      stream: true,
    }
    const result = await svc.handleRequest({
      intent,
      body: { model: 'mock-model', stream: true, messages: [{ role: 'user', content: 'hi' }] },
      requestId: 'stream-rec',
    })
    expect(result.kind).toBe('stream')

    // 关键：流构造后、消费 frames 前，record 尚未发生（修复前会在此刻就记一条 token=0）。
    expect(obs.listRecent()).toHaveLength(0)

    await collectFrames((result as { frames: AsyncIterable<string> }).frames)

    const recs = obs.listRecent()
    expect(recs).toHaveLength(1)
    expect(recs[0].stream).toBe(true)
    expect(recs[0].ok).toBe(true)
    expect(recs[0].inputTokens).toBe(10)
    expect(recs[0].outputTokens).toBe(7)
    expect(recs[0].cacheReadTokens).toBe(3)
  })

  it('流中途出错：流末仍记录一条 ok=false', async () => {
    const adapter = makeMockAdapter(async function* () {
      yield { type: 'text_delta', text: 'partial' } as CanonicalStreamEvent
      throw new Error('mid-stream boom')
    })
    const registry = new PlatformRegistry()
    registry.register(adapter)
    const obs = new ProxyRequestLog()
    const svc = new ApiProxyService(undefined, { registry, observability: obs })

    const intent: RequestIntent = {
      format: 'openai',
      action: 'chat',
      model: 'mock-model',
      stream: true,
    }
    const result = await svc.handleRequest({
      intent,
      body: { model: 'mock-model', stream: true, messages: [{ role: 'user', content: 'hi' }] },
      requestId: 'stream-err',
    })
    await expect(
      collectFrames((result as { frames: AsyncIterable<string> }).frames),
    ).rejects.toThrow()

    const recs = obs.listRecent()
    expect(recs).toHaveLength(1)
    expect(recs[0].ok).toBe(false)
  })
})

// ══════════════════════════════════════════════
// 修复 B：codex-native 透传 平台归属 + usage 旁路
// ══════════════════════════════════════════════
describe('responses 透传 token 记录 — 平台归属 + SSE usage 旁路', () => {
  it('codex-native 流式透传：平台归 codex-native，usage 从 SSE 拆「非缓存+缓存」回填', async () => {
    const codexNative: CodexNativePassthrough = {
      isNativeModel: (m) => m === 'gpt-5',
      proxyResponses: async () => ({
        status: 200,
        stream: (async function* () {
          yield 'event: response.output_text.delta\ndata: {"delta":"hi"}\n\n'
          yield 'event: response.completed\ndata: {"response":{"usage":{"input_tokens":12,"output_tokens":8,"input_tokens_details":{"cached_tokens":4}}}}\n\n'
        })(),
      }),
    }
    const obs = new ProxyRequestLog()
    const svc = new ApiProxyService(undefined, { observability: obs, codexNative })

    const intent: RequestIntent = {
      format: 'openai-responses',
      action: 'responses',
      model: 'gpt-5',
      stream: true,
    }
    const result = await svc.handleRequest({
      intent,
      body: { model: 'gpt-5', stream: true, input: 'hi' },
      requestId: 'cn-stream',
    })
    expect(result.kind).toBe('stream')
    expect(obs.listRecent()).toHaveLength(0)

    await collectFrames((result as { frames: AsyncIterable<string> }).frames)

    const recs = obs.listRecent()
    expect(recs).toHaveLength(1)
    expect(recs[0].platform).toBe('codex-native')
    expect(recs[0].inputTokens).toBe(8) // 12 - 4 cached
    expect(recs[0].outputTokens).toBe(8)
    expect(recs[0].cacheReadTokens).toBe(4)
  })
})

// ══════════════════════════════════════════════
// usage 解析纯函数
// ══════════════════════════════════════════════
describe('responsesUsageToCapture — 口径拆分', () => {
  it('input_tokens 含缓存 → 拆「非缓存新增 + cacheRead」', () => {
    expect(
      responsesUsageToCapture({
        input_tokens: 100,
        output_tokens: 50,
        input_tokens_details: { cached_tokens: 30 },
      }),
    ).toEqual({ inputTokens: 70, outputTokens: 50, cacheReadTokens: 30 })
  })

  it('无缓存细节 → cacheReadTokens 省略', () => {
    expect(responsesUsageToCapture({ input_tokens: 10, output_tokens: 5 })).toEqual({
      inputTokens: 10,
      outputTokens: 5,
    })
  })

  it('全 0 / 非对象 → undefined', () => {
    expect(responsesUsageToCapture({ input_tokens: 0, output_tokens: 0 })).toBeUndefined()
    expect(responsesUsageToCapture(null)).toBeUndefined()
    expect(responsesUsageToCapture(undefined)).toBeUndefined()
  })
})

describe('extractUsageFromSseFrame — 从 SSE 帧提取 usage', () => {
  it('response.completed 帧（usage 在 response.usage）', () => {
    const frame =
      'event: response.completed\ndata: {"response":{"usage":{"input_tokens":12,"output_tokens":8}}}'
    expect(extractUsageFromSseFrame(frame)).toEqual({ inputTokens: 12, outputTokens: 8 })
  })

  it('无 usage / [DONE] / 无 data 行 → undefined', () => {
    expect(extractUsageFromSseFrame('event: response.output_text.delta\ndata: {"delta":"x"}')).toBeUndefined()
    expect(extractUsageFromSseFrame('data: [DONE]')).toBeUndefined()
    expect(extractUsageFromSseFrame('event: ping')).toBeUndefined()
  })
})
