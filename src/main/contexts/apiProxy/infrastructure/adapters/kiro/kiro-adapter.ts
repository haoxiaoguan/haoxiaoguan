// KiroAdapter：apiProxy 的真实 Kiro 上游适配器（implements PlatformUpstreamAdapter）。
// M4 版：账号选择/凭据/代理由 FailoverAdapter 注入到 ctx（ctx.account/credential/dispatcher）；
// KiroAdapter 退化为"用注入上下文发一次请求 + classifyError"的薄层。
// chat/chatStream 内：直接从 ctx 取 account/credential → 解析路由 →
// buildConversationState（M3a）→ runWithDispatcher(ctx.dispatcher) 包住 KiroUpstreamClient 调用。
import { runWithDispatcher } from '../../../../../platform/net/dispatcher-context'
import { getMachineId } from '../../../../../platform/identity/machine-id'
import {
  normalizeRegion,
  parseRegionFromArn,
  resolveKiroAuthMethod,
  KIRO_SOCIAL_PROFILE_ARN,
  KIRO_BUILDER_ID_PROFILE_ARN,
} from '../../../../../platform/net/kiro/kiro-identity-client'
import { mapModelId, normalizeClaudeVersion } from './kiro-model-map'
import { buildConversationState } from './kiro-conversation-state'
import { classifyKiroError } from './kiro-error'
import { KiroUpstreamClient, type KiroCallContext } from './kiro-upstream-client'
import type {
  KiroCredential,
  KiroAccountInfo,
} from './kiro-ports'
import type { PromptCacheTracker } from '../../../domain/usage/prompt-cache-tracker'
import type { PlatformUpstreamAdapter, UpstreamCtx, ModelInfo, ErrorClass } from '../../../domain/platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent, Usage, CacheBreakpointInput } from '../../../domain/canonical'
import type { BuildConversationStateOpts } from './kiro-wire-types'

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
}

// 已解析的一次调用所需路由信息（accountId + envelope + callCtx）。
interface PreparedCall {
  accountId: string
  callCtx: KiroCallContext
  envelope: ReturnType<typeof buildConversationState>
}

export class KiroAdapter implements PlatformUpstreamAdapter {
  readonly platform = 'kiro'
  private readonly clock: () => number

  constructor(private readonly deps: KiroAdapterDeps) {
    this.clock = deps.clock ?? Date.now
  }

  supportsModel(model: string): boolean {
    const norm = normalizeClaudeVersion(model.trim().toLowerCase())
    return /^claude-(sonnet|haiku|opus)/.test(norm)
  }

  listModels(): ModelInfo[] {
    return KIRO_MODELS.map((id) => ({ id, displayName: id }))
  }

  /** 把上游错误归类（委托 classifyKiroError）。 */
  classifyError(err: unknown): ErrorClass {
    return classifyKiroError(err)
  }

  async chat(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<CanonicalResponse> {
    const prepared = this.prepare(ir, ctx)
    const resp = await runWithDispatcher(ctx.dispatcher, () =>
      this.deps.client.chat(prepared.envelope, prepared.callCtx, ir.model, ir),
    )
    return { ...resp, usage: this.applyCacheToUsage(resp.usage, ir.cacheControl, prepared.accountId, ir.model) }
  }

  chatStream(ir: CanonicalRequest, ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    // M4：prepare 改同步（ctx 已含注入的 account/credential/dispatcher）。
    const self = this
    async function* gen(): AsyncIterable<CanonicalStreamEvent> {
      const prepared = self.prepare(ir, ctx)
      const events = await runWithDispatcher(ctx.dispatcher, async () => {
        const out: CanonicalStreamEvent[] = []
        for await (const ev of self.deps.client.chatStream(prepared.envelope, prepared.callCtx, ir.model, ir)) out.push(ev)
        return out
      })
      // M3c：对末 usage 事件做 cache 计费后处理（与 chat 同语义），其余事件原样透传。
      // 假设每个流只有一个 usage 事件（kiro-event-stream 流末补一次）；若上游改发多个 usage
      // 事件，每个都会触发 cacheTracker.update，导致后续 compute 把前次 update 当命中、
      // cache 重复计费。当前上游行为安全。
      for (const ev of events) {
        if (ev.type === 'usage') {
          yield { type: 'usage', usage: self.applyCacheToUsage(ev.usage, ir.cacheControl, prepared.accountId, ir.model) }
          continue
        }
        yield ev
      }
    }
    return gen()
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

    const buildOpts: BuildConversationStateOpts = {
      modelId: mapModelId(ir.model),
      origin: 'AI_EDITOR',
      conversationId: ctx.requestId ?? 'conv',
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
    return { accountId: account.id, callCtx, envelope }
  }
}

// --- 路由解析辅助（profileArn 解析；优先级与 quota/http/kiro.ts 一致） ---

function asRecord(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function pickString(src: unknown, keys: string[]): string | undefined {
  const obj = asRecord(src)
  if (obj === undefined) return undefined
  for (const k of keys) {
    const val = obj[k]
    if (typeof val === 'string' && val.trim().length > 0) return val.trim()
  }
  return undefined
}

// profileArn：显式（profilePayload/rawMetadata）> provider 兜底（Github/Google→社交，否则 BuilderId）。
function resolveProfileArn(account: KiroAccountInfo, cred: KiroCredential): string | undefined {
  const explicit =
    pickString(account.profilePayload, ['profileArn', 'profile_arn']) ??
    pickString(cred.rawMetadata, ['profileArn', 'profile_arn', 'arn'])
  if (explicit !== undefined) return explicit
  const provider = (account.loginProvider ?? pickString(cred.rawMetadata, ['provider']) ?? '').toLowerCase()
  if (provider === 'github' || provider === 'google') return KIRO_SOCIAL_PROFILE_ARN
  // 非社交（含企业/未知）→ BuilderId 兜底（与号小管额度路径一致）。
  return KIRO_BUILDER_ID_PROFILE_ARN
}

// region：显式 region（profilePayload/rawMetadata）优先；否则交给调用方用 parseRegionFromArn 兜底。
function explicitRegion(account: KiroAccountInfo, cred: KiroCredential): string | undefined {
  return (
    pickString(account.profilePayload, ['region']) ??
    pickString(cred.rawMetadata, ['region', 'ssoRegion', 'sso_region'])
  )
}

// machineId：凭据/profilePayload 有则用，无则进程级稳定 getMachineId()（M3b 不派生落库）。
function resolveMachineId(account: KiroAccountInfo, cred: KiroCredential): string {
  return (
    pickString(cred.rawMetadata, ['machineId', 'machine_id']) ??
    pickString(account.profilePayload, ['machineId', 'machine_id']) ??
    getMachineId()
  )
}
