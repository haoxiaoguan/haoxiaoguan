// KiroUpstreamClient：CodeWhisperer generateAssistantResponse 调用的传输层。
// 职责：① 按端点构建请求（url/headers/body=conversationState 信封）；② 经注入 fetchImpl 发送
// （M3b 仅区域 AmazonQ 单端点，接受小写 modelId；CodeWhisperer 大写模型 ID 端点留 M4）；
// ③ 401/403 调一次 refresher 后重试同端点；
// ④ chat 走全量 bytes()→parseKiroEventStream→fold；
// ⑤ chatStream/openStream 走增量 bytesStream()→createKiroEventStreamParser（push/flush 半帧 buffer 已解决丢尾帧）→deltas 即时 yield、usage 流末 flush。
// 代理出站不在此层：KiroAdapter 用 runWithDispatcher 包住调用，defaultKiroFetch 读 currentDispatcher。
// 鉴权头/端点/agentMode 按线协议实现。
import { release } from 'node:os'
import { fetch as undiciFetch } from 'undici'
import { isSuspendedResponse, KiroUpstreamSuspendedError } from './kiro-error'
import { currentDispatcher } from '../../../../../platform/net/dispatcher-context'
import { runtimeEndpointForRegion } from '../../../../../platform/net/kiro/kiro-identity-client'
import { createKiroEventStreamParser, parseKiroEventStream } from './kiro-event-stream'
import { countTextTokens, estimateRequestInputTokens } from '../../../domain/usage/token-estimator'
import { getContextTokensForModel } from '../../../domain/usage/model-context-window'
import { redactString } from '../../../../../platform/log/redact'
import type { ConversationStateEnvelope } from './kiro-wire-types'
import type { KiroTokenRefresher } from './kiro-ports'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
  StopReason,
  Usage,
} from '../../../domain/canonical'

// Amazon 可失效指纹（跟随官方 IDE / AWS SDK 更新；不硬编码进密钥，作模块级常量便于一处更新）。
const AWS_SDK_VERSION = '1.0.34'
const AWS_STREAMING_API_VERSION = '1.0.34'
// 聊天端点专用 IDE 版本（聊天端点可能拒旧版本）。
// 注意与 kiro-identity-client 的 KIRO_IDE_VERSION（额度路径 0.11.107）分离，互不影响。
const KIRO_CHAT_IDE_VERSION = '0.12.155'

// IDC 账号（agentMode=vibe）出站 UA 常量——官方 AmazonQ CLI（Rust 实现）采用的格式。
// 版本号从当前发布版本对齐，需定期跟进（aws-sdk-rust / Rust 编译器 / ssooidc 版本均会随上游迭代）。
const AWS_SDK_RUST_VERSION = '1.3.9'
const RUST_LANG_VERSION = '1.87.0'
const AWS_SSOOIDC_VERSION = '1.88.0'
// Rust SDK UA 格式用 macos/linux/windows 三值（与 JS SDK 的 process.platform#release() 格式不同）。
const CLI_OS_TOKEN: string = process.platform === 'win32' ? 'windows' : process.platform === 'darwin' ? 'macos' : 'linux'

const HTTP_TIMEOUT_MS = 120_000 // 聊天补全可能较慢，给足超时（额度 GET 用 25s，这里放宽）。

// --- 端点表 ---

export interface KiroEndpoint {
  url: string
  origin: string
  name: string
}

/**
 * M3b 阶段端点：只返回区域 AmazonQ 端点（由 region 解析）。
 * CodeWhisperer 端点需大写内部模型 ID（resolveCodeWhispererModelId via ListAvailableModels），
 * 小写 modelId 会被 CodeWhisperer 端点 400，留 M4；M3b 用 AmazonQ 端点接受小写 modelId。
 */
export function endpointsForRegion(region: string): KiroEndpoint[] {
  const amazonQBase = runtimeEndpointForRegion(region).replace(/\/+$/, '')
  return [{ url: `${amazonQBase}/generateAssistantResponse`, origin: 'AI_EDITOR', name: 'AmazonQ' }]
}

// --- 注入 fetch 抽象（mock 友好；默认实现读 ambient dispatcher） ---

export type KiroFetchImpl = (url: string, init: KiroFetchInit) => Promise<KiroFetchResponse>

export interface KiroFetchInit {
  method: string
  headers: Record<string, string>
  body: string
  signal?: AbortSignal
}

/** 窄 Response 投影：状态 + text()（错误体）+ bytes()（全量 body）+ bytesStream()（增量 body）。
 * bytes() 与 bytesStream() 互斥：HTTP body 只能读一次，chat 用 bytes()，流式用 bytesStream()。
 */
export interface KiroFetchResponse {
  ok: boolean
  status: number
  text(): Promise<string>
  bytes(): Promise<Uint8Array>
  /** 逐 chunk 产出 body 字节；与 bytes() 互斥（body 只读一次）。 */
  bytesStream(): AsyncIterable<Uint8Array>
}

// 默认传输：undici fetch（经 ambient proxy dispatcher）+ 超时 controller 覆盖至 body 读完。
// timer 生命周期延至消费路径（bytes/bytesStream/text）各自调 cleanup()，而非 fetch resolve 后立刻清。
// 三条消费路径：① bytes()  ② bytesStream() generator finally  ③ text()（错误体）。
async function defaultKiroFetch(url: string, init: KiroFetchInit): Promise<KiroFetchResponse> {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), HTTP_TIMEOUT_MS)
  // 调用方 signal 与超时 signal 任一触发即中止。
  const onAbort = (): void => controller.abort()
  if (init.signal !== undefined) {
    if (init.signal.aborted) controller.abort()
    else init.signal.addEventListener('abort', onAbort, { once: true })
  }

  // 幂等清理：clearTimeout + removeEventListener，多次调用安全。
  let cleaned = false
  const cleanup = (): void => {
    if (cleaned) return
    cleaned = true
    clearTimeout(timer)
    if (init.signal !== undefined) init.signal.removeEventListener('abort', onAbort)
  }

  const dispatcher = currentDispatcher()
  let resp: Response
  try {
    resp =
      dispatcher !== undefined
        ? ((await undiciFetch(url, {
            method: init.method,
            headers: init.headers,
            body: init.body,
            signal: controller.signal,
            dispatcher,
          })) as unknown as Response)
        : await fetch(url, { method: init.method, headers: init.headers, body: init.body, signal: controller.signal })
  } catch (e) {
    cleanup()
    throw e
  }

  return {
    ok: resp.ok,
    status: resp.status,
    // text()：错误体；读完后清理 timer。
    text: async () => {
      try {
        return await resp.text()
      } finally {
        cleanup()
      }
    },
    // bytes()：全量 buffer；await 完成后清理 timer。
    bytes: async () => {
      try {
        return new Uint8Array(await resp.arrayBuffer())
      } finally {
        cleanup()
      }
    },
    // bytesStream()：逐 chunk 产出；generator finally 清理 timer（含调用方提前 break 的情形）。
    // body 为 null 时（如空响应）直接结束，generator 正常终止 → 上层 parseStream flush() 仍补 usage+message_stop。
    bytesStream: async function* () {
      const body = resp.body as ReadableStream<Uint8Array> | null
      if (body === null) { cleanup(); return }
      const reader = body.getReader()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          if (value) yield value
        }
      } finally {
        reader.releaseLock()
        cleanup()
      }
    },
  }
}

// --- UA 头构造 ---

function osToken(): string {
  return `${process.platform}#${release()}`
}

function buildHeaders(ctx: KiroCallContext): Record<string, string> {
  let userAgent: string
  let amzUserAgent: string

  if (ctx.agentMode === 'vibe') {
    // IDC 账号：使用官方 AmazonQ CLI（Rust 实现）的 UA 格式。
    // machineId 嵌入 x-amz-user-agent，与官方 CLI 行为一致。
    userAgent = `aws-sdk-rust/${AWS_SDK_RUST_VERSION} os/${CLI_OS_TOKEN} lang/rust/${RUST_LANG_VERSION}`
    amzUserAgent = `aws-sdk-rust/${AWS_SDK_RUST_VERSION} ua/2.1 api/ssooidc/${AWS_SSOOIDC_VERSION} os/${CLI_OS_TOKEN} lang/rust/${RUST_LANG_VERSION} m/E app/AmazonQ-For-CLI`
  } else {
    // Social/BuilderID 账号：保持现有 JS SDK UA 格式不变。
    // 两个 UA 头格式不同：
    //   user-agent 后缀用破折号：`KiroIDE-${V}-${mid}`
    //   x-amz-user-agent 后缀用空格：`KiroIDE ${V} ${mid}`
    const dashSuffix = `KiroIDE-${KIRO_CHAT_IDE_VERSION}-${ctx.machineId}`
    const spaceSuffix = `KiroIDE ${KIRO_CHAT_IDE_VERSION} ${ctx.machineId}`
    userAgent = `aws-sdk-js/${AWS_SDK_VERSION} ua/2.1 os/${osToken()} lang/js md/nodejs#${process.versions.node} api/codewhispererstreaming#${AWS_STREAMING_API_VERSION} m/E ${dashSuffix}`
    amzUserAgent = `aws-sdk-js/${AWS_SDK_VERSION} ${spaceSuffix}`
  }

  return {
    'content-type': 'application/json',
    'x-amzn-kiro-agent-mode': ctx.agentMode,
    'x-amz-user-agent': amzUserAgent,
    'user-agent': userAgent,
    'amz-sdk-invocation-id': ctx.invocationId,
    'amz-sdk-request': 'attempt=1; max=3',
    Authorization: `Bearer ${ctx.accessToken}`,
  }
}

// --- 调用上下文 / 请求 / client ---

export interface KiroCallContext {
  accessToken: string
  refreshToken?: string
  region: string
  profileArn?: string
  machineId: string
  agentMode: 'spec' | 'vibe'
  invocationId: string
  signal?: AbortSignal
}

export interface KiroHttpRequest {
  url: string
  method: 'POST'
  headers: Record<string, string>
  body: string
}

export interface KiroUpstreamClientOpts {
  fetchImpl?: KiroFetchImpl
  refresher: KiroTokenRefresher
}

// 抛给上层的鉴权错误（刷新失败/无法刷新时）。
export class KiroUpstreamAuthError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'KiroUpstreamAuthError'
  }
}

// 所有端点耗尽后的错误。
export class KiroUpstreamError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message)
    this.name = 'KiroUpstreamError'
  }
}

export class KiroUpstreamClient {
  private readonly fetchImpl: KiroFetchImpl
  private readonly refresher: KiroTokenRefresher

  constructor(opts: KiroUpstreamClientOpts) {
    this.fetchImpl = opts.fetchImpl ?? defaultKiroFetch
    this.refresher = opts.refresher
  }

  /** 构建单端点请求（纯函数，无副作用；origin 已在 envelope 内，均 'AI_EDITOR'）。 */
  buildRequest(endpoint: KiroEndpoint, envelope: ConversationStateEnvelope, ctx: KiroCallContext): KiroHttpRequest {
    void endpoint.origin // AmazonQ 端点 origin 'AI_EDITOR'，envelope 内已设；保留字段以备 M4 CodeWhisperer 端点差异。
    return { url: endpoint.url, method: 'POST', headers: buildHeaders(ctx), body: JSON.stringify(envelope) }
  }

  /** 非流式：端点回退 + 401/403 刷新重试一次 → 全量 buffer → 解析 → 折叠 CanonicalResponse（含 usage 估算）。 */
  async chat(
    envelope: ConversationStateEnvelope,
    ctx: KiroCallContext,
    model: string,
    request: CanonicalRequest,
  ): Promise<CanonicalResponse> {
    const bytes = await this.send(envelope, ctx)
    const events = parseKiroEventStream(bytes)
    return foldEventsToResponse(events, model, request)
  }

  /** 向后兼容 wrapper：委托给增量路径 openStream，现有调用/测试不破。 */
  async *chatStream(
    envelope: ConversationStateEnvelope,
    ctx: KiroCallContext,
    model: string,
    request: CanonicalRequest,
  ): AsyncIterable<CanonicalStreamEvent> {
    yield* await this.openStream(envelope, ctx, model, request)
  }

  /**
   * 流式入口：在调用者 context 内完成 fetch 发起（含端点回退 + 刷新重试），
   * 返回已绑定响应 body 的增量事件 generator（后续消费无需持有 dispatcher context）。
   */
  async openStream(
    envelope: ConversationStateEnvelope,
    ctx: KiroCallContext,
    model: string,
    request: CanonicalRequest,
  ): Promise<AsyncIterable<CanonicalStreamEvent>> {
    const body = await this.sendStream(envelope, ctx)
    return this.parseStream(body, model, request)
  }

  /** 非流式：端点回退 + 401/403 单次刷新重试 → 返回全量响应字节。 */
  private async send(envelope: ConversationStateEnvelope, ctx: KiroCallContext): Promise<Uint8Array> {
    const resp = await this.attemptSend(envelope, ctx)
    return resp.bytes()
  }

  /**
   * 流式传输层：端点回退 + 401/403 单次刷新重试，与 send 完全相同的鉴权/封禁/429 分支，
   * 唯一区别：返回 resp.bytesStream() 而非 resp.bytes()。
   */
  private async sendStream(envelope: ConversationStateEnvelope, ctx: KiroCallContext): Promise<AsyncIterable<Uint8Array>> {
    const resp = await this.attemptSend(envelope, ctx)
    return resp.bytesStream()
  }

  /**
   * 端点回退 + 401/403 单次刷新重试核心循环 → 返回 ok 的 KiroFetchResponse（调用方再选消费方式）。
   * 429/suspended/auth 失败分支与此前 send 的行为逐字一致；错误体 text() 在此读取（不在消费路径）。
   * M3b 端点表仅含 AmazonQ 单端点；M4 多端点后自动按序回退。
   */
  private async attemptSend(envelope: ConversationStateEnvelope, ctx: KiroCallContext): Promise<KiroFetchResponse> {
    const endpoints = endpointsForRegion(ctx.region)
    let lastError: Error | undefined
    let curCtx = ctx
    let refreshed = false

    for (const endpoint of endpoints) {
      // 每端点最多两轮：原始 → （401/403 且尚未刷新）刷新后重试同端点一次。
      for (let attempt = 0; attempt < 2; attempt++) {
        const req = this.buildRequest(endpoint, envelope, curCtx)
        let resp: KiroFetchResponse
        try {
          resp = await this.fetchImpl(req.url, {
            method: req.method,
            headers: req.headers,
            body: req.body,
            ...(curCtx.signal ? { signal: curCtx.signal } : {}),
          })
        } catch (e) {
          // 出站异常（代理/DNS/超时）：记录后上抛，便于真机排查（不含凭据）。
          console.error(`[apiProxy:kiro] ${endpoint.name} fetch exception: ${redactString((e as Error)?.message ?? '')}`)
          throw e
        }

        if (resp.ok) return resp

        const body = await resp.text()
        // 非 2xx：记录 AWS 响应（不含凭据/machineId），便于真机排查 400/403/429。
        console.error(`[apiProxy:kiro] ${endpoint.name} HTTP ${resp.status}: ${redactString(body.slice(0, 600))}`)

        if (resp.status === 429) {
          // 配额耗尽：记录错误并结束本端点（不刷新）；无更多端点时抛出。
          lastError = new KiroUpstreamError(`quota exhausted on ${endpoint.name} (429)`, 429)
          break
        }

        if (isSuspendedResponse(resp.status, body)) {
          // 风控封禁：token 有效，刷新无用 → 直接抛专用错误，由故障转移装饰器永久退役该账号。
          throw new KiroUpstreamSuspendedError(`account suspended (${resp.status}): ${body.slice(0, 200)}`, resp.status)
        }

        if (resp.status === 401 || resp.status === 403) {
          if (!refreshed) {
            const next = await this.refresher.refresh(toCred(curCtx), curCtx.region)
            if (next !== undefined) {
              refreshed = true
              curCtx = {
                ...curCtx,
                accessToken: next.token,
                ...(next.refreshToken ? { refreshToken: next.refreshToken } : {}),
              }
              continue // 同端点用新 token 再试一次。
            }
          }
          // 无法刷新或刷新后仍 401 → 鉴权错误，不再尝试其它端点。
          throw new KiroUpstreamAuthError(`auth error ${resp.status}: ${body}`, resp.status)
        }

        // 其它非 2xx：记录后换下一个端点。
        lastError = new KiroUpstreamError(`upstream error ${resp.status}: ${body}`, resp.status)
        break
      }
    }

    throw lastError ?? new KiroUpstreamError('all kiro endpoints failed', 502)
  }

  /**
   * 增量流事件解析器：逐 chunk 喂入 parser，delta 事件即时 yield；
   * 流末 flush 收口：usage 事件替换为本地估算（output 数累积输出文本，input 按 contextPct 反推或降级）。
   */
  private async *parseStream(
    body: AsyncIterable<Uint8Array>,
    model: string,
    request: CanonicalRequest,
  ): AsyncIterable<CanonicalStreamEvent> {
    const parser = createKiroEventStreamParser()
    let outputText = ''
    for await (const chunk of body) {
      for (const ev of parser.push(chunk)) {
        if (ev.type === 'text_delta' || ev.type === 'thinking_delta') outputText += ev.text
        else if (ev.type === 'tool_use_delta') outputText += ev.partialJson
        yield ev
      }
    }
    for (const ev of parser.flush()) {
      if (ev.type === 'usage') {
        const usage = estimateUsage(model, request, outputText, ev.contextUsagePercentage)
        yield {
          type: 'usage',
          usage,
          ...(ev.contextUsagePercentage !== undefined ? { contextUsagePercentage: ev.contextUsagePercentage } : {}),
        }
      } else {
        yield ev
      }
    }
  }
}

// KiroCallContext → KiroCredential（喂 refresher.refresh；只需 token/refreshToken）。
function toCred(ctx: KiroCallContext): { token: string; refreshToken?: string } {
  return { token: ctx.accessToken, ...(ctx.refreshToken ? { refreshToken: ctx.refreshToken } : {}) }
}

// --- 事件流折叠为 CanonicalResponse ---

interface ToolFold {
  index: number
  id: string
  name: string
  json: string
}

/**
 * 把 parseKiroEventStream 的事件序列折叠为非流式 CanonicalResponse。
 * 连续 text/thinking 各并为单块；tool_use_start 开块、tool_use_delta 累积 JSON，结束统一 parse。
 * content 块按首次出现顺序保序。stopReason 取流末事件。
 * usage 不取上游零值，而由 estimateUsage 本地估算（output 数输出文本；input 按 contextUsagePercentage
 * 反推减 output，无百分比时降级估算请求文本）。
 */
export function foldEventsToResponse(
  events: CanonicalStreamEvent[],
  model: string,
  request: CanonicalRequest,
): CanonicalResponse {
  const content: ContentBlock[] = []
  let stopReason: StopReason = 'end_turn'
  let outputChars = ''
  let contextPct: number | undefined

  let textBuf: { type: 'text'; text: string } | null = null
  let thinkBuf: { type: 'thinking'; text: string } | null = null
  const tools = new Map<number, ToolFold>()

  const flushText = (): void => {
    if (textBuf !== null) {
      content.push(textBuf)
      textBuf = null
    }
  }
  const flushThink = (): void => {
    if (thinkBuf !== null) {
      content.push(thinkBuf)
      thinkBuf = null
    }
  }

  for (const ev of events) {
    if (ev.type === 'text_delta') {
      flushThink()
      if (textBuf === null) textBuf = { type: 'text', text: '' }
      textBuf.text += ev.text
      outputChars += ev.text
    } else if (ev.type === 'thinking_delta') {
      flushText()
      if (thinkBuf === null) thinkBuf = { type: 'thinking', text: '' }
      thinkBuf.text += ev.text
      outputChars += ev.text
    } else if (ev.type === 'tool_use_start') {
      flushText()
      flushThink()
      const fold: ToolFold = { index: ev.index, id: ev.id, name: ev.name, json: '' }
      tools.set(ev.index, fold)
      // 占位入 content（保序）；input 折叠结束时回填。
      content.push({ type: 'tool_use', id: ev.id, name: ev.name, input: {} })
    } else if (ev.type === 'tool_use_delta') {
      const fold = tools.get(ev.index)
      if (fold !== undefined) fold.json += ev.partialJson
      outputChars += ev.partialJson
    } else if (ev.type === 'usage') {
      contextPct = ev.contextUsagePercentage
    } else if (ev.type === 'message_stop') {
      stopReason = ev.stopReason
    }
  }
  flushText()
  flushThink()

  // 回填 tool_use input（JSON.parse，失败给错误占位避免抛错断链）。
  for (const fold of tools.values()) {
    const block = content.find(
      (b): b is { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } =>
        b.type === 'tool_use' && b.id === fold.id,
    )
    if (block === undefined) continue
    if (fold.json.length === 0) {
      block.input = {}
      continue
    }
    try {
      const parsed = JSON.parse(fold.json)
      block.input = parsed !== null && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : { value: parsed }
    } catch {
      block.input = { _error: 'tool input parse failed', _partial: fold.json.slice(0, 500) }
    }
  }

  const usage = estimateUsage(model, request, outputChars, contextPct)

  // Kiro 上游（CodeWhisperer）事件流无截断信号（无 finishReason/limitReached 等字段）。
  // 本地推断：当 outputTokens 达到请求 maxTokens 且当前 stopReason 为 'end_turn' 时，
  // 改写为 'max_tokens'（真机抓帧确认上游确无该信号后可移除此推断，直接依赖上游信号）。
  if (stopReason === 'end_turn' && request.maxTokens !== undefined && usage.outputTokens >= request.maxTokens) {
    stopReason = 'max_tokens'
  }

  return { model, content, stopReason, usage }
}

/**
 * usage 估算（纯函数）。
 * - output：数本次响应输出文本（text/thinking/tool 入参 JSON 累积）的 token。
 * - input：优先按上游 contextUsagePercentage 反推（窗口×pct/100 − output，下限 0）；
 *   无百分比时降级估算请求文本（estimateRequestInputTokens）。
 */
export function estimateUsage(
  model: string,
  request: CanonicalRequest,
  outputText: string,
  contextPct: number | undefined,
): Usage {
  const outputTokens = outputText.length > 0 ? countTextTokens(outputText) : 0
  let inputTokens: number
  if (contextPct !== undefined && contextPct > 0) {
    const total = Math.round((getContextTokensForModel(model) * contextPct) / 100)
    inputTokens = Math.max(0, total - outputTokens)
  } else {
    inputTokens = estimateRequestInputTokens(request)
  }
  return { inputTokens, outputTokens }
}
