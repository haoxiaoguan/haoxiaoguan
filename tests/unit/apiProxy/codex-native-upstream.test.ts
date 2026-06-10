// CodexNativeUpstream + CodexNativeTokenManager + loadCodexNativemodels 单测（TDD）。
// 用假 http（捕获 url/headers/body + 编排响应）与假 SecretStore，禁真网络/真额度。
// 验证：
//   ① isNativeModel / supportsModel / listModels / platform
//   ② proxyResponses 流式 → 透传头正确（Authorization 改写、chatgpt-account-id、默认头、deny 剥离、入站保真）
//   ③ proxyResponses 非流式 → 返回 body
//   ④ 上游 401 → forceRefresh + 重试一次（第二次用新 token）
//   ⑤ chat / chatStream 命中 → 抛 CodexNativeUnsupportedError
//   ⑥ classifyError 映射
//   ⑦ TokenManager 播种择新（own vs auth.json）+ 刷新轮换 + 无登录
//   ⑧ loadCodexNativeModels 解析 + 兜底
import { describe, it, expect } from 'vitest'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  CodexNativeUpstream,
  CodexNativeUnsupportedError,
  CHATGPT_RESPONSES_URL,
  type CodexNativeHttp,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/codex-native/codex-native-upstream'
import {
  CodexNativeTokenManager,
  CodexNativeNoLoginError,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/codex-native/codex-native-token-manager'
import { loadCodexNativeModels } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/codex-native/codex-native-models'
import { RelayHttpError } from '../../../src/main/contexts/apiProxy/infrastructure/adapters/relay/relay-upstream-client'
import type { SecretStore } from '../../../src/main/contexts/sync/infrastructure/secret-store'
import type { ModelInfo } from '../../../src/main/contexts/apiProxy/domain/platform-adapter'
import type { CanonicalRequest } from '../../../src/main/contexts/apiProxy/domain/canonical'

// ─── 工具 ───────────────────────────────────────────────────────────────────

function b64url(o: unknown): string {
  return Buffer.from(JSON.stringify(o)).toString('base64url')
}
/** 造一个仅含 payload 的假 JWT（jwtPayload 只解 segment[1]）。 */
function fakeJwt(payload: Record<string, unknown>): string {
  return `${b64url({ alg: 'none' })}.${b64url(payload)}.sig`
}

/** 内存 SecretStore。 */
function memStore(initial: string | null = null): SecretStore & { value: string | null } {
  return {
    value: initial,
    async get() {
      return this.value
    },
    async set(v: string) {
      this.value = v
    },
    async clear() {
      this.value = null
    },
  }
}

interface Captured {
  url: string
  headers: Record<string, string>
  body: unknown
}

/** 可编排的假 http：post/postStream 记录调用，按队列返回。 */
function makeFakeHttp(opts: {
  streamQueue?: Array<{ status: number; chunks: string[] } | RelayHttpError>
  jsonQueue?: Array<{ status: number; body: unknown } | RelayHttpError>
  postJson?: unknown // 刷新端点（oauth/token）返回
}): CodexNativeHttp & { calls: Captured[] } {
  const calls: Captured[] = []
  const streamQ = (opts.streamQueue ?? []).slice()
  const jsonQ = (opts.jsonQueue ?? []).slice()
  return {
    calls,
    async post(url, headers, body) {
      calls.push({ url, headers, body })
      // oauth/token 刷新走这里
      if (url.includes('oauth/token')) {
        return { status: 200, json: async () => opts.postJson ?? {} }
      }
      const next = jsonQ.shift()
      if (next instanceof RelayHttpError) throw next
      if (next === undefined) throw new Error('jsonQueue exhausted')
      return { status: next.status, json: async () => next.body }
    },
    async postStream(url, headers, body) {
      calls.push({ url, headers, body })
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
}

const MODELS: ModelInfo[] = [
  { id: 'gpt-5.5', displayName: 'GPT-5.5' },
  { id: 'gpt-5.4', displayName: 'GPT-5.4' },
]

/** 造一个 own-store 已播种的 token manager（authJsonPath 指向不存在路径）。 */
function seededTokens(http: CodexNativeHttp, accessToken: string, opts?: { lastRefreshEpoch?: number }): CodexNativeTokenManager {
  const store = memStore(
    JSON.stringify({
      accessToken,
      refreshToken: 'rt-A',
      accountId: 'acc-1',
      lastRefreshEpoch: opts?.lastRefreshEpoch ?? 9_000_000_000_000,
    }),
  )
  return new CodexNativeTokenManager({
    store,
    http: http as unknown as { post: CodexNativeHttp['post'] },
    authJsonPath: join(tmpdir(), 'definitely-absent-auth.json'),
    clock: () => 1_700_000_000_000,
  })
}

function req(model = 'gpt-5.5'): CanonicalRequest {
  return { model, messages: [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }], stream: false }
}

// ─── ① 基本能力 ──────────────────────────────────────────────────────────────

describe('CodexNativeUpstream basics', () => {
  const http = makeFakeHttp({})
  const up = new CodexNativeUpstream({ tokens: seededTokens(http, 'tok-A'), http, models: MODELS })

  it('① platform / isNativeModel / supportsModel / listModels', () => {
    expect(up.platform).toBe('codex-native')
    expect(up.isNativeModel('gpt-5.5')).toBe(true)
    expect(up.isNativeModel('gpt-5.4')).toBe(true)
    expect(up.isNativeModel('deepseek-chat')).toBe(false)
    expect(up.isNativeModel(undefined)).toBe(false)
    expect(up.supportsModel('gpt-5.5')).toBe(true)
    expect(up.listModels().map((m) => m.id)).toEqual(['gpt-5.5', 'gpt-5.4'])
  })

  it('⑤ chat / chatStream 命中 → CodexNativeUnsupportedError', async () => {
    await expect(up.chat(req(), {})).rejects.toBeInstanceOf(CodexNativeUnsupportedError)
    await expect(async () => {
      for await (const _ of up.chatStream(req(), {})) void _
    }).rejects.toBeInstanceOf(CodexNativeUnsupportedError)
  })

  it('⑥ classifyError 映射', () => {
    expect(up.classifyError(new RelayHttpError('x', 429))).toBe('RATE_LIMIT')
    expect(up.classifyError(new RelayHttpError('x', 401))).toBe('AUTH')
    expect(up.classifyError(new RelayHttpError('x', 400))).toBe('FATAL')
    expect(up.classifyError(new RelayHttpError('x', 500))).toBe('SERVER')
    expect(up.classifyError(new CodexNativeNoLoginError())).toBe('AUTH')
    expect(up.classifyError(new Error('net'))).toBe('SERVER')
  })
})

// ─── ② 透传头 ────────────────────────────────────────────────────────────────

describe('CodexNativeUpstream.proxyResponses headers', () => {
  it('② 流式：改写 Authorization、注入 account-id、默认头、剥 deny、保真入站', async () => {
    const http = makeFakeHttp({ streamQueue: [{ status: 200, chunks: ['event: x\n', 'data: {}\n\n'] }] })
    const up = new CodexNativeUpstream({ tokens: seededTokens(http, 'tok-A'), http, models: MODELS })
    const result = await up.proxyResponses({
      body: { model: 'gpt-5.5', stream: true },
      requestId: 'r1',
      stream: true,
      headers: {
        authorization: 'Bearer hxg-client-key', // 应被改写
        host: 'localhost', // deny
        'content-length': '42', // deny
        'session_id': 'sess-9', // 保真
        'user-agent': 'codex_cli_rs/1.0', // 保真
      },
    })
    expect(result.status).toBe(200)
    // 透传 SSE 帧
    const frames: string[] = []
    for await (const f of result.stream!) frames.push(f)
    expect(frames.join('')).toBe('event: x\ndata: {}\n\n')

    const call = http.calls[0]
    expect(call.url).toBe(CHATGPT_RESPONSES_URL)
    expect(call.headers['authorization']).toBe('Bearer tok-A') // 改写为 OAuth
    expect(call.headers['chatgpt-account-id']).toBe('acc-1')
    expect(call.headers['session_id']).toBe('sess-9') // 保真
    expect(call.headers['user-agent']).toBe('codex_cli_rs/1.0') // 保真
    expect(call.headers['openai-beta']).toBe('responses=experimental') // 默认注入
    expect(call.headers['originator']).toBe('codex_cli_rs') // 默认注入
    expect(call.headers['host']).toBeUndefined() // deny
    expect(call.headers['content-length']).toBeUndefined() // deny
    expect(call.body).toEqual({ model: 'gpt-5.5', stream: true }) // body 原样
  })

  it('③ 非流式：返回 body', async () => {
    const http = makeFakeHttp({ jsonQueue: [{ status: 200, body: { ok: true, output: [] } }] })
    const up = new CodexNativeUpstream({ tokens: seededTokens(http, 'tok-A'), http, models: MODELS })
    const result = await up.proxyResponses({ body: { model: 'gpt-5.5' }, requestId: 'r2', stream: false })
    expect(result.status).toBe(200)
    expect(result.body).toEqual({ ok: true, output: [] })
    expect(result.stream).toBeUndefined()
  })

  it('④ 上游 401 → 刷新并重试一次（第二次用新 token）', async () => {
    const http = makeFakeHttp({
      streamQueue: [new RelayHttpError('unauthorized', 401), { status: 200, chunks: ['data: ok\n\n'] }],
      postJson: { access_token: 'tok-B' },
    })
    const up = new CodexNativeUpstream({ tokens: seededTokens(http, 'tok-A'), http, models: MODELS })
    const result = await up.proxyResponses({ body: { model: 'gpt-5.5', stream: true }, requestId: 'r3', stream: true })
    const frames: string[] = []
    for await (const f of result.stream!) frames.push(f)
    expect(frames.join('')).toBe('data: ok\n\n')
    // 调用序：postStream(401) → post(oauth/token) → postStream(200)
    expect(http.calls[0].url).toBe(CHATGPT_RESPONSES_URL)
    expect(http.calls[1].url).toContain('oauth/token')
    expect(http.calls[2].url).toBe(CHATGPT_RESPONSES_URL)
    expect(http.calls[2].headers['authorization']).toBe('Bearer tok-B') // 用刷新后的 token
  })
})

// ─── ⑦ TokenManager ──────────────────────────────────────────────────────────

describe('CodexNativeTokenManager', () => {
  it('⑦ 无登录（own 空 + auth.json 缺）→ CodexNativeNoLoginError', async () => {
    const http = makeFakeHttp({})
    const mgr = new CodexNativeTokenManager({
      store: memStore(null),
      http: http as unknown as { post: CodexNativeHttp['post'] },
      authJsonPath: join(tmpdir(), 'absent.json'),
      clock: () => 1_700_000_000_000,
    })
    await expect(mgr.ensureToken()).rejects.toBeInstanceOf(CodexNativeNoLoginError)
  })

  it('⑦ access_token 未过期 → 直接返回，不刷新', async () => {
    const http = makeFakeHttp({})
    const future = Math.floor(1_700_000_000_000 / 1000) + 10_000
    const mgr = seededTokens(http, fakeJwt({ exp: future }))
    const tok = await mgr.ensureToken()
    expect(tok.accessToken).toContain('.') // 仍是原 JWT
    expect(tok.accountId).toBe('acc-1')
    expect(http.calls.length).toBe(0) // 未触发刷新
  })

  it('⑦ access_token 将过期 → 自动刷新（轮换 refresh_token）', async () => {
    const http = makeFakeHttp({ postJson: { access_token: 'tok-fresh', refresh_token: 'rt-NEW' } })
    const past = Math.floor(1_700_000_000_000 / 1000) - 10 // 已过期
    const store = memStore(
      JSON.stringify({ accessToken: fakeJwt({ exp: past }), refreshToken: 'rt-OLD', accountId: 'acc-1', lastRefreshEpoch: 1 }),
    )
    const mgr = new CodexNativeTokenManager({
      store,
      http: http as unknown as { post: CodexNativeHttp['post'] },
      authJsonPath: join(tmpdir(), 'absent.json'),
      clock: () => 1_700_000_000_000,
    })
    const tok = await mgr.ensureToken()
    expect(tok.accessToken).toBe('tok-fresh')
    // 刷新请求带旧 refresh_token
    expect(http.calls[0].url).toContain('oauth/token')
    expect((http.calls[0].body as { refresh_token: string }).refresh_token).toBe('rt-OLD')
    // 新 token 已持久化（含轮换后的 refresh_token）
    expect(store.value).toContain('tok-fresh')
    expect(store.value).toContain('rt-NEW')
  })

  it('⑦ 播种择新：auth.json.last_refresh 更新 → 用 auth.json', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-auth-'))
    const authPath = join(dir, 'auth.json')
    try {
      writeFileSync(
        authPath,
        JSON.stringify({
          last_refresh: '2099-01-01T00:00:00Z', // 远新于 own 的 epoch=1
          tokens: { access_token: 'tok-FROM-AUTH', refresh_token: 'rt-AUTH', account_id: 'acc-from-auth' },
        }),
      )
      const http = makeFakeHttp({})
      const store = memStore(
        JSON.stringify({ accessToken: 'tok-OWN', refreshToken: 'rt-OWN', accountId: 'acc-own', lastRefreshEpoch: 1 }),
      )
      const mgr = new CodexNativeTokenManager({
        store,
        http: http as unknown as { post: CodexNativeHttp['post'] },
        authJsonPath: authPath,
        clock: () => 1_700_000_000_000,
      })
      const tok = await mgr.ensureToken()
      expect(tok.accessToken).toBe('tok-FROM-AUTH')
      expect(tok.accountId).toBe('acc-from-auth')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⑦ authPresent 反映文件存在性', () => {
    expect(CodexNativeTokenManager.authPresent(join(tmpdir(), 'nope.json'))).toBe(false)
  })
})

// ─── ⑧ loadCodexNativeModels ─────────────────────────────────────────────────

describe('loadCodexNativeModels', () => {
  it('⑧ 解析 models_cache.json（slug/display_name/context_window）', () => {
    const dir = mkdtempSync(join(tmpdir(), 'codex-cache-'))
    const cachePath = join(dir, 'models_cache.json')
    try {
      writeFileSync(
        cachePath,
        JSON.stringify({
          models: [
            { slug: 'gpt-5.5', display_name: 'GPT-5.5', context_window: 400000 },
            { slug: 'gpt-5.4', display_name: 'GPT-5.4' },
            { display_name: 'no-slug' }, // 应被过滤
          ],
        }),
      )
      const models = loadCodexNativeModels(cachePath)
      expect(models.map((m) => m.id)).toEqual(['gpt-5.5', 'gpt-5.4'])
      expect(models[0].contextLength).toBe(400000)
      expect(models[0].ownedBy).toBe('openai')
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('⑧ 缺失/损坏 → 静态兜底（含 gpt-5.5）', () => {
    const models = loadCodexNativeModels(join(tmpdir(), 'absent-cache.json'))
    expect(models.length).toBeGreaterThan(0)
    expect(models.some((m) => m.id === 'gpt-5.5')).toBe(true)
  })
})
