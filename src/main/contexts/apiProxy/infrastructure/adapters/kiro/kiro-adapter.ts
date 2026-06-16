// KiroAdapter：apiProxy 的真实 Kiro 上游适配器（implements PlatformUpstreamAdapter）。
// M4 版：账号选择/凭据/代理由 FailoverAdapter 注入到 ctx（ctx.account/credential/dispatcher）；
// KiroAdapter 退化为"用注入上下文发一次请求 + classifyError"的薄层。
// chat/chatStream 内：直接从 ctx 取 account/credential → 解析路由 →
// buildConversationState（M3a）→ runWithDispatcher(ctx.dispatcher) 包住 KiroUpstreamClient 调用。
import { randomUUID } from 'node:crypto'
import { createHash } from 'node:crypto'
import { runWithDispatcher } from '../../../../../platform/net/dispatcher-context'
import {
  normalizeRegion,
  parseRegionFromArn,
  resolveKiroAuthMethod,
} from '../../../../../platform/net/kiro/kiro-identity-client'
import { resolveProfileArn, explicitRegion, resolveMachineId } from './kiro-account-fingerprint'
import { mapModelId, normalizeClaudeVersion, resolveCodeWhispererModelId } from './kiro-model-map'
import { buildConversationState } from './kiro-conversation-state'
import { classifyKiroError } from './kiro-error'
import { KiroUpstreamClient, type KiroCallContext, type KiroSendOpts } from './kiro-upstream-client'
import type {
  KiroCredential,
  KiroAccountInfo,
} from './kiro-ports'
import type { PromptCacheTracker } from '../../../domain/usage/prompt-cache-tracker'
import { getContextTokensForModel } from '../../../domain/usage/model-context-window'
import type { PlatformUpstreamAdapter, UpstreamCtx, ModelInfo, ErrorClass } from '../../../domain/platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent, Usage, CacheBreakpointInput } from '../../../domain/canonical'
import type { BuildConversationStateOpts } from './kiro-wire-types'
import type { ConversationIdCache } from '../../../domain/account-selection/conversation-id-cache'

// Kiro 对外暴露的模型集（spec §12：Kiro 支持的 Claude 模型）。供 /v1/models 与裸路由模型感知。
const KIRO_MODELS: readonly string[] = [
  'claude-sonnet-4.5',
  'claude-opus-4.5',
  'claude-opus-4.6',
  'claude-opus-4.7',
  'claude-opus-4.8',
  'claude-haiku-4.5',
  'claude-sonnet-4',
]

/** 无可用账号 / 凭据缺失。handleRequest / IPC 上层据此映射 503 友好错误体。 */
export class NoKiroAccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoKiroAccountError'
  }
}

/** M4 版：deps 仅保留 client + cacheTracker；账号/凭据/代理由 FailoverAdapter 经 ctx 注入。 */
export interface KiroAdapterDeps {
  client: KiroUpstreamClient
  cacheTracker: PromptCacheTracker
  /** 注入时钟（默认 Date.now）；便于测试注入固定时间戳。 */
  clock?: () => number
  /** conversationId 稳定复用缓存（P2-2）。注入后 prepare 优先从缓存取稳定 id。 */
  conversationIdCache?: ConversationIdCache
  /** conversationId 生成函数（默认 randomUUID）。 */
  genConversationId?: () => string
  /**
   * 是否启用 CodeWhisperer 端点（大写内部模型 ID）。默认 false。
   * 仅当为 true 且 ListAvailableModels 结果能解析出大写 ID 时，才走 CodeWhisperer 端点；
   * 否则完全保持现状（AmazonQ 单端点 + 小写 modelId）——零回归。
   * 注意：CodeWhisperer 端点行为待真实账号验证后默认启用。
   */
  enableCodeWhisperer?: boolean
  /**
   * 可用模型列表（来自 ListAvailableModels，用于 resolveCodeWhispererModelId）。
   * 仅在 enableCodeWhisperer=true 时有意义；可按账号按需注入或通过 ModelListCache 刷新。
   */
  availableModels?: readonly { modelId: string }[]
}

// 已解析的一次调用所需路由信息（accountId + envelope + callCtx）。
interface PreparedCall {
  accountId: string
  callCtx: KiroCallContext
  envelope: ReturnType<typeof buildConversationState>
  /** CodeWhisperer 大写内部模型 ID（仅 enableCodeWhisperer=true 且解析成功时有值）。 */
  cwModelId?: string | undefined
}

export class KiroAdapter implements PlatformUpstreamAdapter {
  readonly platform = 'kiro'
  private readonly clock: () => number
  private readonly genConversationId: () => string

  constructor(private readonly deps: KiroAdapterDeps) {
    this.clock = deps.clock ?? Date.now
    this.genConversationId = deps.genConversationId ?? randomUUID
  }

  supportsModel(model: string): boolean {
    const norm = normalizeClaudeVersion(model.trim().toLowerCase())
    return /^claude-(sonnet|haiku|opus)/.test(norm)
  }

  listModels(): ModelInfo[] {
    // Kiro 暴露的均为 Claude（支持 thinking + prompt caching）；上下文窗口按版本推断。
    return KIRO_MODELS.map((id) => ({
      id,
      displayName: id,
      contextLength: getContextTokensForModel(id),
      maxOutputTokens: 64_000,
      supportsThinking: true,
      supportsPromptCaching: true,
      ownedBy: 'anthropic',
    }))
  }

  /** 把上游错误归类（委托 classifyKiroError）。 */
  classifyError(err: unknown): ErrorClass {
    return classifyKiroError(err)
  }

  async chat(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<CanonicalResponse> {
    const prepared = this.prepare(ir, ctx)
    const sendOpts = this.makeSendOpts(prepared)
    const resp = await runWithDispatcher(ctx.dispatcher, () =>
      this.deps.client.chat(prepared.envelope, prepared.callCtx, ir.model, ir, sendOpts),
    )
    return { ...resp, usage: this.applyCacheToUsage(resp.usage, ir.cacheControl, prepared.accountId, ir.model) }
  }

  chatStream(ir: CanonicalRequest, ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    // 增量迭代：openStream 在 runWithDispatcher 内 await 完成 fetch 发起（dispatcher context 内绑定），
    // 返回的 generator 在 context 外消费（undici body 已绑 dispatcher，无需再持有 context）。
    // M3c：对末 usage 事件做 cache 计费后处理（与 chat 同语义），其余事件增量透传。
    // 假设每个流只有一个 usage 事件（kiro-event-stream 流末补一次）；若上游改发多个 usage
    // 事件，每个都会触发 cacheTracker.update，导致后续 compute 把前次 update 当命中、
    // cache 重复计费。当前上游行为安全。
    const self = this
    async function* gen(): AsyncIterable<CanonicalStreamEvent> {
      const prepared = self.prepare(ir, ctx)
      const sendOpts = self.makeSendOpts(prepared)
      const stream = await runWithDispatcher(ctx.dispatcher, () =>
        self.deps.client.openStream(prepared.envelope, prepared.callCtx, ir.model, ir, sendOpts),
      )
      for await (const ev of stream) {
        if (ev.type === 'usage') {
          yield { type: 'usage', usage: self.applyCacheToUsage(ev.usage, ir.cacheControl, prepared.accountId, ir.model) }
          continue
        }
        yield ev
      }
    }
    return gen()
  }

  /** 从 PreparedCall 构建 KiroSendOpts（仅 enableCodeWhisperer=true 且 cwModelId 存在时才激活 CW 路径）。 */
  private makeSendOpts(prepared: PreparedCall): KiroSendOpts | undefined {
    if (this.deps.enableCodeWhisperer !== true || prepared.cwModelId === undefined) return undefined
    return { enableCodeWhisperer: true, cwModelId: prepared.cwModelId }
  }

  // cache 计费后处理：compute 读命中 → update 写账号级指纹表（请求成功后），把命中填进 usage，
  // 并把 inputTokens 改成扣除 cache 命中后的未缓存部分（billed）。无 cacheControl → 原样返回。
  private applyCacheToUsage(usage: Usage, cacheControl: CacheBreakpointInput[] | undefined, accountId: string, model: string): Usage {
    if (cacheControl === undefined || cacheControl.length === 0) return usage
    const profile = this.deps.cacheTracker.buildProfile(cacheControl, usage.inputTokens, model)
    if (profile === null) return usage
    const now = this.clock()
    const cu = this.deps.cacheTracker.compute(accountId, profile, now)
    this.deps.cacheTracker.update(accountId, profile, now)
    const billed = Math.max(usage.inputTokens - cu.cacheCreationInputTokens - cu.cacheReadInputTokens, 0)
    return {
      inputTokens: billed,
      outputTokens: usage.outputTokens,
      ...(cu.cacheReadInputTokens > 0 ? { cacheReadTokens: cu.cacheReadInputTokens } : {}),
      ...(cu.cacheCreationInputTokens > 0 ? { cacheWriteTokens: cu.cacheCreationInputTokens } : {}),
    }
  }

  // 从 ctx.account/credential 取路由信息 → 组 envelope + callCtx（同步，无 IO）。
  // 缺 account/credential 时抛 NoKiroAccountError（FailoverAdapter 须注入，否则配置有误）。
  private prepare(ir: CanonicalRequest, ctx: UpstreamCtx): PreparedCall {
    const account = ctx.account
    const cred = ctx.credential
    if (account === undefined || cred === undefined) {
      throw new NoKiroAccountError('kiro adapter requires ctx.account and ctx.credential (inject via FailoverAdapter)')
    }

    const authMethod = resolveKiroAuthMethod(cred.rawMetadata)
    const profileArn = resolveProfileArn(account, cred)
    const region = normalizeRegion(explicitRegion(account, cred) ?? parseRegionFromArn(profileArn))
    const machineId = resolveMachineId(account, cred)
    const agentMode: 'spec' | 'vibe' = authMethod === 'idc' ? 'vibe' : 'spec'
    const invocationId = ctx.requestId ?? 'req'

    // conversationId 稳定复用（P2-2）：
    // key 优先 ctx.sessionHint；无则用前两条消息 text 内容的 sha256 前 24 hex；两者都无 → undefined。
    // 有 key 且 cache 已注入 → getOrCreate；否则回退 ctx.requestId ?? 'conv'。
    const cacheKey = ctx.sessionHint ?? historyFingerprint(ir)
    const conversationId = (cacheKey !== undefined && this.deps.conversationIdCache !== undefined)
      ? this.deps.conversationIdCache.getOrCreate(cacheKey, this.genConversationId)
      : (ctx.requestId ?? 'conv')

    // CodeWhisperer 实验路径（enableCodeWhisperer=true + 模型缓存解析出大写 ID）：
    // 用大写内部 ID 构建 envelope，后续 buildRequest 按端点 modelIdStyle 选取。
    // 默认（enableCodeWhisperer=false 或解析失败）：小写 ID，AmazonQ 路径，逐字不变。
    // 注意：CodeWhisperer 端点行为待真实账号验证后默认启用。
    const lowercaseModelId = mapModelId(ir.model)
    let resolvedCwModelId: string | undefined
    if (this.deps.enableCodeWhisperer === true && this.deps.availableModels !== undefined) {
      resolvedCwModelId = resolveCodeWhispererModelId(ir.model, this.deps.availableModels)
    }

    // envelope 始终用小写 modelId 构建（AmazonQ 兼容）；CodeWhisperer 端点在 buildRequest 时替换。
    const buildOpts: BuildConversationStateOpts = {
      modelId: lowercaseModelId,
      origin: 'AI_EDITOR',
      conversationId,
      ...(profileArn !== undefined ? { profileArn } : {}),
    }
    const envelope = buildConversationState(ir, buildOpts)

    const callCtx: KiroCallContext = {
      accessToken: cred.token,
      ...(cred.refreshToken !== undefined ? { refreshToken: cred.refreshToken } : {}),
      region,
      ...(profileArn !== undefined ? { profileArn } : {}),
      machineId,
      agentMode,
      invocationId,
      ...(ctx.signal !== undefined ? { signal: ctx.signal } : {}),
    }
    return { accountId: account.id, callCtx, envelope, cwModelId: resolvedCwModelId }
  }
}

// --- conversationId fingerprint 辅助 ---

/**
 * 从前两条 IR 消息的 text 内容生成 sha256 前 24 hex 作为 fingerprint key。
 * 无消息或消息无 text 内容 → undefined（不走缓存，回退 requestId）。
 */
function historyFingerprint(ir: CanonicalRequest): string | undefined {
  const msgs = ir.messages.slice(0, 2)
  const parts: string[] = []
  for (const m of msgs) {
    const texts = m.content
      .filter((b) => b.type === 'text')
      .map((b) => (b as { type: 'text'; text: string }).text)
      .join('')
    if (texts.length > 0) parts.push(texts)
  }
  if (parts.length === 0) return undefined
  return createHash('sha256').update(parts.join('\n')).digest('hex').slice(0, 24)
}

// 路由解析辅助（profileArn / region / machineId）已抽取到 ./kiro-account-fingerprint，供本适配器
// 与模型目录（KiroModelCatalog 调 ListAvailableModels）共用同一套解析。
