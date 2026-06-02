// KiroAdapter：apiProxy 的真实 Kiro 上游适配器（implements PlatformUpstreamAdapter）。
// chat/chatStream 内：选 active 账号 → 取解密凭据 → 解析 region/profileArn/machineId/agentMode →
// buildConversationState（M3a）→ runWithDispatcher(账号代理) 包住 KiroUpstreamClient 调用（spec §16）。
// 账号选择 M3b 占位（findActiveKiroAccount 取首个）；池/选择/故障转移留 M4。
// machineId M3b 只读（凭据/profilePayload 有则用，无则 getMachineId() 进程级稳定 id），不写库。
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
import { KiroUpstreamClient, type KiroCallContext } from './kiro-upstream-client'
import type {
  KiroCredentialPort,
  KiroAccountPort,
  KiroDispatcherPort,
  KiroCredential,
  KiroAccountInfo,
} from './kiro-ports'
import type { PromptCacheTracker } from './prompt-cache-tracker'
import type { PlatformUpstreamAdapter, UpstreamCtx, ModelInfo } from '../../../domain/platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent, Usage } from '../../../domain/canonical'
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

export interface KiroAdapterDeps {
  credentials: KiroCredentialPort
  accounts: KiroAccountPort
  dispatchers: KiroDispatcherPort
  client: KiroUpstreamClient
  cacheTracker: PromptCacheTracker
}

// 已解析的一次调用所需路由信息（account + envelope + callCtx）。
interface PreparedCall {
  accountId: string
  callCtx: KiroCallContext
  envelope: ReturnType<typeof buildConversationState>
}

export class KiroAdapter implements PlatformUpstreamAdapter {
  readonly platform = 'kiro'

  constructor(private readonly deps: KiroAdapterDeps) {}

  supportsModel(model: string): boolean {
    const norm = normalizeClaudeVersion(model.trim().toLowerCase())
    return /^claude-(sonnet|haiku|opus)/.test(norm)
  }

  listModels(): ModelInfo[] {
    return KIRO_MODELS.map((id) => ({ id, displayName: id }))
  }

  async chat(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<CanonicalResponse> {
    const prepared = await this.prepare(ir, ctx)
    const dispatcher = await this.deps.dispatchers.dispatcherForAccount(prepared.accountId)
    const resp = await runWithDispatcher(dispatcher, () =>
      this.deps.client.chat(prepared.envelope, prepared.callCtx, ir.model, ir),
    )
    return this.applyCache(ir, prepared.accountId, resp)
  }

  // M3c：cache 计费后处理（非流式）。拿 ir.cacheControl（仅 Anthropic 入站填充）+ accountId 调
  // tracker：compute 读命中 → update 写账号级指纹表（请求成功后），把命中填进 usage，并把
  // inputTokens 改成扣除 cache 命中后的未缓存部分（billed）。无 cacheControl → 原样返回。
  private applyCache(ir: CanonicalRequest, accountId: string, resp: CanonicalResponse): CanonicalResponse {
    if (ir.cacheControl === undefined || ir.cacheControl.length === 0) return resp
    const profile = this.deps.cacheTracker.buildProfile(ir.cacheControl, resp.usage.inputTokens, ir.model)
    if (profile === null) return resp
    const now = Date.now()
    const cu = this.deps.cacheTracker.compute(accountId, profile, now)
    this.deps.cacheTracker.update(accountId, profile, now)
    const billed = Math.max(resp.usage.inputTokens - cu.cacheCreationInputTokens - cu.cacheReadInputTokens, 0)
    const usage: Usage = {
      inputTokens: billed,
      outputTokens: resp.usage.outputTokens,
      ...(cu.cacheReadInputTokens > 0 ? { cacheReadTokens: cu.cacheReadInputTokens } : {}),
      ...(cu.cacheCreationInputTokens > 0 ? { cacheWriteTokens: cu.cacheCreationInputTokens } : {}),
    }
    return { ...resp, usage }
  }

  chatStream(ir: CanonicalRequest, ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    // M3b：在生成器内先 prepare + runWithDispatcher 收集全部事件（client.chatStream 全量 buffer），
    // 再逐个 yield。dispatcher 在 fetch 期间生效（spec §16）。真增量逐 token 透传留 M4。
    const self = this
    async function* gen(): AsyncIterable<CanonicalStreamEvent> {
      const prepared = await self.prepare(ir, ctx)
      const dispatcher = await self.deps.dispatchers.dispatcherForAccount(prepared.accountId)
      const events = await runWithDispatcher(dispatcher, async () => {
        const out: CanonicalStreamEvent[] = []
        for await (const ev of self.deps.client.chatStream(prepared.envelope, prepared.callCtx, ir.model, ir)) out.push(ev)
        return out
      })
      // M3c：对末 usage 事件做 cache 计费后处理（与 chat 同语义），其余事件原样透传。
      for (const ev of events) {
        if (ev.type === 'usage' && ir.cacheControl !== undefined && ir.cacheControl.length > 0) {
          const profile = self.deps.cacheTracker.buildProfile(ir.cacheControl, ev.usage.inputTokens, ir.model)
          if (profile !== null) {
            const now = Date.now()
            const cu = self.deps.cacheTracker.compute(prepared.accountId, profile, now)
            self.deps.cacheTracker.update(prepared.accountId, profile, now)
            const billed = Math.max(ev.usage.inputTokens - cu.cacheCreationInputTokens - cu.cacheReadInputTokens, 0)
            yield {
              type: 'usage',
              usage: {
                inputTokens: billed,
                outputTokens: ev.usage.outputTokens,
                ...(cu.cacheReadInputTokens > 0 ? { cacheReadTokens: cu.cacheReadInputTokens } : {}),
                ...(cu.cacheCreationInputTokens > 0 ? { cacheWriteTokens: cu.cacheCreationInputTokens } : {}),
              },
            }
            continue
          }
        }
        yield ev
      }
    }
    return gen()
  }

  // 选号 → 取凭据 → 解析路由 → 组 envelope + callCtx。
  private async prepare(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<PreparedCall> {
    const account = await this.deps.accounts.findActiveKiroAccount()
    if (account === null) throw new NoKiroAccountError('no active kiro account available')
    const cred = await this.deps.credentials.retrieve(account.id)
    if (cred === null) throw new NoKiroAccountError(`kiro credential missing for account ${account.id}`)

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
