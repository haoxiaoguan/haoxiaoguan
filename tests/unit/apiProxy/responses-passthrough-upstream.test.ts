// ResponsesPassthroughUpstream 单测（针对性 TDD）。
// 验证：
//   ① supportsModel / listModels / platform（alias 暴露）
//   ② isNativeModel（按 alias）
//   ③ proxyResponses 流式：Authorization 替换为第三方 key，deny 头被剥，入站头保真，SSE 帧透传
//   ④ proxyResponses 非流式：返回 body
//   ⑤ model alias→real 映射（请求体 model 字段被替换为 real；alias===real 时不替换对象引用）
//   ⑥ chat / chatStream 命中 → 抛 ResponsesPassthroughUnsupportedError
//   ⑦ classifyError 映射
import { describe, it, expect } from 'vitest'
import {
  ResponsesPassthroughUpstream,
  ResponsesPassthroughUnsupportedError,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/responses-passthrough-upstream'
import { RelayHttpError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/relay-upstream-client'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'

// ─── 假 RelayUpstreamClient ──────────────────────────────────────────────────

interface Captured {
  url: string
  headers: Record<string, string>
  body: unknown
}

function makeFakeClient(opts: {
  streamQueue?: Array<{ status: number; chunks: string[] } | RelayHttpError>
  jsonQueue?: Array<{ status: number; body: unknown } | RelayHttpError>
}): import('../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/relay-upstream-client').RelayUpstreamClient & { calls: Captured[] } {
  const calls: Captured[] = []
  const streamQ = (opts.streamQueue ?? []).slice()
  const jsonQ = (opts.jsonQueue ?? []).slice()

  const client = {
    calls,
    async post(url: string, headers: Record<string, string>, bodyJson: unknown) {
      calls.push({ url, headers, body: bodyJson })
      const next = jsonQ.shift()
      if (next instanceof RelayHttpError) throw next
      if (next === undefined) throw new Error('jsonQueue exhausted')
      const captured = next
      return {
        status: captured.status,
        text: async () => JSON.stringify(captured.body),
        json: async () => captured.body,
      }
    },
    async postStream(url: string, headers: Record<string, string>, bodyJson: unknown) {
      calls.push({ url, headers, body: bodyJson })
      const next = streamQ.shift()
      if (next instanceof RelayHttpError) throw next
      if (next === undefined) throw new Error('streamQueue exhausted')
      const chunks = next.chunks
      return {
        status: next.status,
        chunks() {
          return (async function* () {
            for (const c of chunks) yield c
          })()
        },
      }
    },
  }
  // Cast to RelayUpstreamClient for interface compatibility
  return client as unknown as typeof client
}

function makeUpstream(opts?: {
  models?: Array<{ alias: string; real: string }>
  streamQueue?: Array<{ status: number; chunks: string[] } | RelayHttpError>
  jsonQueue?: Array<{ status: number; body: unknown } | RelayHttpError>
}) {
  const client = makeFakeClient({
    streamQueue: opts?.streamQueue,
    jsonQueue: opts?.jsonQueue,
  })
  const up = new ResponsesPassthroughUpstream({
    platform: 'relay-tp-resp',
    baseUrl: 'https://api.example.com/v1',
    apiKey: 'tp-secret-key',
    models: opts?.models ?? [
      { alias: 'resp-model-a', real: 'resp-model-a' },
      { alias: 'gpt-5.5-hxg', real: 'gpt-5.5' },
    ],
    client: client as any,
  })
  return { up, client }
}

function req(): CanonicalRequest {
  return { model: 'resp-model-a', messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], stream: false }
}

// ─── ① supportsModel / listModels / platform ────────────────────────────────

describe('ResponsesPassthroughUpstream basics', () => {
  it('① platform / supportsModel(alias) / listModels(alias) / isNativeModel(alias)', () => {
    const { up } = makeUpstream()
    expect(up.platform).toBe('relay-tp-resp')
    // supportsModel 按 alias 判断
    expect(up.supportsModel('resp-model-a')).toBe(true)
    expect(up.supportsModel('gpt-5.5-hxg')).toBe(true) // alias
    expect(up.supportsModel('gpt-5.5')).toBe(false) // real 不直接暴露
    expect(up.supportsModel('unknown')).toBe(false)
    // isNativeModel 同 supportsModel
    expect(up.isNativeModel('resp-model-a')).toBe(true)
    expect(up.isNativeModel('gpt-5.5-hxg')).toBe(true)
    expect(up.isNativeModel(undefined)).toBe(false)
    // listModels 按 alias
    const ids = up.listModels().map((m) => m.id)
    expect(ids).toContain('resp-model-a')
    expect(ids).toContain('gpt-5.5-hxg')
    expect(ids).not.toContain('gpt-5.5') // real 不暴露
  })

  it('⑥ chat / chatStream 命中 → ResponsesPassthroughUnsupportedError', async () => {
    const { up } = makeUpstream()
    await expect(up.chat(req(), {})).rejects.toBeInstanceOf(ResponsesPassthroughUnsupportedError)
    await expect(async () => {
      for await (const _ of up.chatStream(req(), {})) void _
    }).rejects.toBeInstanceOf(ResponsesPassthroughUnsupportedError)
  })

  it('⑦ classifyError 映射', () => {
    const { up } = makeUpstream()
    expect(up.classifyError(new RelayHttpError('x', 429))).toBe('RATE_LIMIT')
    expect(up.classifyError(new RelayHttpError('x', 401))).toBe('AUTH')
    expect(up.classifyError(new RelayHttpError('x', 403))).toBe('AUTH')
    expect(up.classifyError(new RelayHttpError('x', 400))).toBe('FATAL')
    expect(up.classifyError(new RelayHttpError('x', 422))).toBe('FATAL')
    expect(up.classifyError(new RelayHttpError('x', 500))).toBe('SERVER')
    expect(up.classifyError(new Error('net'))).toBe('SERVER')
  })
})

// ─── ② 透传头 + Authorization 替换 ──────────────────────────────────────────

describe('ResponsesPassthroughUpstream.proxyResponses headers', () => {
  it('③ 流式：Authorization 改写为第三方 key，deny 头被剥，入站头保真，SSE 帧透传', async () => {
    const { up, client } = makeUpstream({
      streamQueue: [{ status: 200, chunks: ['data: a\n\n', 'data: b\n\n'] }],
    })
    const result = await up.proxyResponses({
      body: { model: 'resp-model-a', stream: true },
      requestId: 'r1',
      stream: true,
      headers: {
        authorization: 'Bearer hxg-client-key', // 应被替换
        host: 'localhost',                        // deny
        'content-length': '99',                  // deny
        'openai-beta': 'responses=v1',            // 保真
        'x-request-id': 'req-42',                // 保真
      },
    })
    expect(result.status).toBe(200)
    const frames: string[] = []
    for await (const f of result.stream!) frames.push(f)
    expect(frames.join('')).toBe('data: a\n\ndata: b\n\n')

    const call = client.calls[0]
    // URL 正确：baseUrl + /responses
    expect(call.url).toBe('https://api.example.com/v1/responses')
    // Authorization 替换为第三方 key
    expect(call.headers['authorization']).toBe('Bearer tp-secret-key')
    // 保真入站头
    expect(call.headers['openai-beta']).toBe('responses=v1')
    expect(call.headers['x-request-id']).toBe('req-42')
    // deny 头被剥
    expect(call.headers['host']).toBeUndefined()
    expect(call.headers['content-length']).toBeUndefined()
  })

  it('④ 非流式：返回 body', async () => {
    const { up, client } = makeUpstream({
      jsonQueue: [{ status: 200, body: { id: 'resp-1', output: [] } }],
    })
    const result = await up.proxyResponses({
      body: { model: 'resp-model-a' },
      requestId: 'r2',
      stream: false,
    })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ id: 'resp-1', output: [] })
    expect(result.stream).toBeUndefined()
    expect(client.calls[0].url).toBe('https://api.example.com/v1/responses')
  })
})

// ─── ⑤ model alias→real 映射 ──────────────────────────────────────────────

describe('ResponsesPassthroughUpstream model alias rewrite', () => {
  it('⑤ alias → real 映射：请求体 model 被替换为真名', async () => {
    const { up, client } = makeUpstream({
      models: [{ alias: 'gpt-5.5-hxg', real: 'gpt-5.5' }],
      jsonQueue: [{ status: 200, body: {} }],
    })
    await up.proxyResponses({
      body: { model: 'gpt-5.5-hxg', store: false },
      requestId: 'r3',
      stream: false,
    })
    // 出站请求体 model 字段被替换为 real
    expect((client.calls[0].body as Record<string, unknown>).model).toBe('gpt-5.5')
    // 其它字段保持
    expect((client.calls[0].body as Record<string, unknown>).store).toBe(false)
  })

  it('⑤ alias===real：请求体保持原值，不替换对象', async () => {
    const { up, client } = makeUpstream({
      models: [{ alias: 'resp-model-a', real: 'resp-model-a' }],
      jsonQueue: [{ status: 200, body: {} }],
    })
    const body = { model: 'resp-model-a', extra: 'x' }
    await up.proxyResponses({ body, requestId: 'r4', stream: false })
    // alias===real 时对象不被替换（引用或值相同均可）
    expect((client.calls[0].body as Record<string, unknown>).model).toBe('resp-model-a')
    expect((client.calls[0].body as Record<string, unknown>).extra).toBe('x')
  })

  it('⑤ body model 不在 alias 表中：原样透传', async () => {
    const { up, client } = makeUpstream({
      models: [{ alias: 'resp-model-a', real: 'resp-model-a' }],
      jsonQueue: [{ status: 200, body: {} }],
    })
    await up.proxyResponses({ body: { model: 'unknown-model' }, requestId: 'r5', stream: false })
    expect((client.calls[0].body as Record<string, unknown>).model).toBe('unknown-model')
  })
})
