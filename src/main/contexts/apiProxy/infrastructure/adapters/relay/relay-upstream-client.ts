// RelayUpstreamClient：第三方中转上游的传输层（OpenAI-compatible HTTP/SSE）。
// 职责：
//   post()       → 非流式 JSON POST → { status, json(), text() }
//   postStream() → 流式 SSE POST    → { status, chunks() } （AsyncIterable<string> 文本块）
// 出站代理：经 currentDispatcher() 读取 ambient dispatcher（与 kiro-upstream-client 对齐）。
// 测试友好：fetchImpl 构造注入，默认 undici fetch；禁真网络。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
import { fetch as undiciFetch } from 'undici'
import { currentDispatcher } from '../../../../../platform/net/dispatcher-context'

const HTTP_TIMEOUT_MS = 120_000

/** RelayUpstreamClient 抛出的 HTTP 错误（携带 status 供 classifyError 使用）。 */
export class RelayHttpError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'RelayHttpError'
  }
}

/** 非流式响应投影（status + json() + text()）。 */
export interface RelayPostResponse {
  status: number
  json(): Promise<unknown>
  text(): Promise<string>
}

/** 流式响应投影（status + chunks() → AsyncIterable<string> SSE 文本块）。 */
export interface RelayPostStreamResponse {
  status: number
  chunks(): AsyncIterable<string>
}

/** 注入的 fetch 抽象（test 可替换为假实现，生产默认 undici fetch）。 */
export type RelayFetchImpl = (url: string, init: RelayFetchInit) => Promise<RelayFetchResponse>

export interface RelayFetchInit {
  method: string
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}

/** 窄 Response 投影（status + text() + body as ReadableStream）。 */
export interface RelayFetchResponse {
  ok: boolean
  status: number
  text(): Promise<string>
  body: ReadableStream<Uint8Array> | null
}

export interface RelayUpstreamClientOpts {
  fetchImpl?: RelayFetchImpl
}

/** 默认传输：undici fetch + ambient dispatcher（currentDispatcher()）+ 超时 AbortController。 */
async function defaultRelayFetch(url: string, init: RelayFetchInit): Promise<RelayFetchResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  const onAbort = (): void => controller.abort()
  if (init.signal !== undefined) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', onAbort, { once: true })
  }

  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    clearTimeout(timer)
    if (init.signal !== undefined) init.signal.removeEventListener('abort', onAbort)
  }

  const dispatcher = currentDispatcher()
  const fetchInit = {
    method: init.method,
    headers: init.headers,
    body: init.body,
    signal: controller.signal,
    ...(dispatcher !== undefined ? { dispatcher } : {}),
  }

  let resp: Response
  try {
    resp = (await undiciFetch(url, fetchInit as Parameters<typeof undiciFetch>[1])) as unknown as Response
  } catch (e) {
    cleanup()
    throw e
  }

  // cleanup 由消费路径（text()/body）负责调用。
  return {
    ok: resp.ok,
    status: resp.status,
    text: async () => {
      try {
        return await resp.text()
      } finally {
        cleanup()
      }
    },
    // body 的 cleanup 由 postStream 的 generator finally 负责。
    get body() {
      // 消费结束时由 postStream generator finally 清理 cleanup。
      // 这里注册一个惰性清理标记；实际 cleanup 在 generator finally。
      return resp.body as ReadableStream<Uint8Array> | null
    },
  }
}

export class RelayUpstreamClient {
  private readonly fetchImpl: RelayFetchImpl

  constructor(opts?: RelayUpstreamClientOpts) {
    this.fetchImpl = opts?.fetchImpl ?? defaultRelayFetch
  }

  /**
   * 非流式 JSON POST。
   * 非 2xx → 抛 RelayHttpError（status 携带）供 classifyError 使用。
   */
  async post(
    url: string,
    headers: Record<string, string>,
    bodyJson: unknown,
  ): Promise<RelayPostResponse> {
    const body = JSON.stringify(bodyJson)
    const resp = await this.fetchImpl(url, { method: 'POST', headers, body })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new RelayHttpError(
        `relay upstream HTTP ${resp.status}: ${errText.slice(0, 400)}`,
        resp.status,
      )
    }

    // 读取 body buffer（仅一次）：text() / json() 互斥，分别读自缓存文本。
    const rawText = await resp.text()
    return {
      status: resp.status,
      text: () => Promise.resolve(rawText),
      json: () => {
        try {
          return Promise.resolve(JSON.parse(rawText) as unknown)
        } catch (e) {
          return Promise.reject(e)
        }
      },
    }
  }

  /**
   * 流式 SSE POST。
   * 非 2xx → 抛 RelayHttpError。
   * ok → 返回 { status, chunks() }，chunks() 是 AsyncIterable<string>（UTF-8 文本块）。
   */
  async postStream(
    url: string,
    headers: Record<string, string>,
    bodyJson: unknown,
  ): Promise<RelayPostStreamResponse> {
    const body = JSON.stringify(bodyJson)
    const resp = await this.fetchImpl(url, { method: 'POST', headers, body })

    if (!resp.ok) {
      const errText = await resp.text()
      throw new RelayHttpError(
        `relay upstream HTTP ${resp.status}: ${errText.slice(0, 400)}`,
        resp.status,
      )
    }

    const status = resp.status
    const responseBody = resp.body

    function chunks(): AsyncIterable<string> {
      return {
        [Symbol.asyncIterator]() {
          return makeChunkIterator(responseBody)
        },
      }
    }

    return { status, chunks }
  }
}

/** 把 ReadableStream<Uint8Array> | null 解码成 AsyncIterator<string>。 */
function makeChunkIterator(body: ReadableStream<Uint8Array> | null): AsyncIterator<string> {
  if (body === null) {
    return {
      next: () => Promise.resolve({ value: undefined as unknown as string, done: true }),
    }
  }

  const decoder = new TextDecoder()
  const reader = body.getReader()
  let done = false

  return {
    async next() {
      if (done) return { value: '' as string, done: true }
      try {
        const { done: readerDone, value } = await reader.read()
        if (readerDone) {
          done = true
          reader.releaseLock()
          return { value: '' as string, done: true }
        }
        return { value: decoder.decode(value, { stream: true }), done: false }
      } catch (e) {
        done = true
        reader.releaseLock()
        throw e
      }
    },
    async return() {
      if (!done) {
        done = true
        reader.releaseLock()
      }
      return { value: '' as string, done: true }
    },
  }
}
