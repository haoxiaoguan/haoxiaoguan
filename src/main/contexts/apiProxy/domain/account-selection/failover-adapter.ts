// 故障转移装饰器：对 inner adapter 套上"多账号选择 + 切号重试 + 健康标记"。
// 注册进 PlatformRegistry 后，handleRequest 一视同仁调 chat/chatStream，故障转移对上层透明。
import type {
  PlatformUpstreamAdapter,
  UpstreamCtx,
  ModelInfo,
  ErrorClass,
} from '../platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../canonical'
import type { AccountPoolSelector, PoolCandidate } from './account-pool-selector'
import type { AccountHealthTracker } from './account-health-tracker'
import type {
  KiroAccountPort,
  KiroCredentialPort,
  KiroDispatcherPort,
  KiroAccountInfo,
} from '../../infrastructure/adapters/kiro/kiro-ports'

/** 候选池全不可用（全 suspended/冷却/满载）。映射 HTTP 503。 */
export class NoHealthyAccountError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoHealthyAccountError'
  }
}

/**
 * 额度重置时间解析 port（402 额度耗尽时用）：返回该账号下一次配额重置的绝对时间戳（epoch ms），
 * 拿不到（无重置时间/查询失败）返回 undefined → 由调用方退回默认冷却。
 * 实现按平台解析（如 Kiro getUsageLimits 的 resetAt），由 container 桥接 quota 上下文注入。
 */
export interface QuotaResetResolverPort {
  resetAtForAccount(accountId: string): Promise<number | undefined>
}

export interface FailoverDeps {
  inner: PlatformUpstreamAdapter
  selector: AccountPoolSelector
  health: AccountHealthTracker
  accounts: KiroAccountPort
  credentials: KiroCredentialPort
  dispatchers: KiroDispatcherPort
  maxRetries: number
  /**
   * 账号池成员门控：仅返回 true 的账号才进候选（「账号必须在池内才能被反代」）。
   * 不注入时默认全部放行（向后兼容，单测无需关心）。空池 → 无候选 → NoHealthyAccountError(503)。
   */
  isPooled?: (accountId: string) => boolean
  /**
   * 账号选号权重优先级（来自反代池成员配置）。不注入默认 0（等权重）。
   * 喂给 AccountPoolSelector 做加权选号。
   */
  getPriority?: (accountId: string) => number
  /**
   * 账号并发上限（来自反代池成员配置）。不注入则候选不带 concurrency，
   * 由 AccountPoolSelector 回退到全局 perAccountConcurrency。
   */
  getConcurrency?: (accountId: string) => number
  /** SERVER 类错误切号前等待时长（ms），给上游喘息。默认 100ms。实际等待加 ±20% jitter。 */
  retryDelayMs: number
  /**
   * 额度重置时间解析器（402 额度耗尽用）：拿到 resetAt → 冷却该账号到重置时间；
   * 不注入或返回 undefined → 退回默认配额冷却（health.markQuotaExhausted，quotaResetMs）。
   */
  quotaReset?: QuotaResetResolverPort
  /**
   * 移出反代池回调（DEPOOL 用）：token 永久失效（401/403 刷不出新 token）→ setPooled(false)。
   * 不注入则跳过移池（仅记一次失败熔断）。持久化由实现负责（写穿账号池仓储）。
   */
  removeFromPool?: (accountId: string) => Promise<void>
  /** 可注入 sleep 函数（测试用），默认 setTimeout。 */
  sleep?: (ms: number) => Promise<void>
  /** 可注入随机函数（测试用），默认 Math.random。用于退避 jitter。 */
  random?: () => number
}

/**
 * 故障转移装饰器：对 inner adapter 套上"多账号选择 + 切号重试 + 健康标记"。
 * 注册进 PlatformRegistry 后，handleRequest 一视同仁调 chat/chatStream，故障转移对上层透明。
 */
export class FailoverAdapter implements PlatformUpstreamAdapter {
  private readonly sleep: (ms: number) => Promise<void>
  private readonly random: () => number

  constructor(private readonly deps: FailoverDeps) {
    this.sleep = deps.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)))
    this.random = deps.random ?? Math.random
  }

  get platform(): string {
    return this.deps.inner.platform
  }
  supportsModel(model: string): boolean {
    return this.deps.inner.supportsModel(model)
  }
  listModels(): ModelInfo[] {
    return this.deps.inner.listModels()
  }
  classifyError(err: unknown): ErrorClass {
    return this.deps.inner.classifyError(err)
  }

  async chat(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<CanonicalResponse> {
    const pool = await this.pool()
    const triedIds = new Set<string>()
    let lastError: unknown
    for (let attempt = 0; attempt < this.deps.maxRetries; attempt++) {
      const lease = this.deps.selector.acquire(pool.list, this.selCtx(ir, ctx, triedIds))
      if (lease === null) break
      if (ctx.observation) ctx.observation.attempts += 1
      try {
        const innerCtx = await this.bindAccount(ctx, lease.id, pool.byId.get(lease.id)!)
        const resp = await this.deps.inner.chat(ir, innerCtx)
        this.deps.health.recordSuccess(lease.id)
        if (ctx.observation) ctx.observation.accountId = lease.id
        const _hint = ctx.sessionHint
        if (_hint !== undefined) this.deps.selector.remember(_hint, lease.id)
        return resp
      } catch (err) {
        const cls = this.deps.inner.classifyError(err)
        await this.penalize(lease.id, cls)
        triedIds.add(lease.id)
        lastError = err
        if (cls === 'FATAL') throw err
        // SERVER 错误：给上游/网络喘息后再切号（±20% jitter 防止多账号同时解冻风暴）。
        if (cls === 'SERVER')
          await this.sleep(Math.round(this.deps.retryDelayMs * (0.8 + this.random() * 0.4)))
      } finally {
        lease.release()
      }
    }
    throw lastError ?? new NoHealthyAccountError('no healthy account available')
  }

  chatStream(ir: CanonicalRequest, ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    const self = this
    return (async function* (): AsyncIterable<CanonicalStreamEvent> {
      const pool = await self.pool()
      const triedIds = new Set<string>()
      let lastError: unknown
      for (let attempt = 0; attempt < self.deps.maxRetries; attempt++) {
        const lease = self.deps.selector.acquire(pool.list, self.selCtx(ir, ctx, triedIds))
        if (lease === null) break
        if (ctx.observation) ctx.observation.attempts += 1
        let started = false
        let it: AsyncIterator<CanonicalStreamEvent> | undefined
        try {
          const innerCtx = await self.bindAccount(ctx, lease.id, pool.byId.get(lease.id)!)
          it = self.deps.inner.chatStream(ir, innerCtx)[Symbol.asyncIterator]()
          let next = await it.next() // 首个 event：inner 已发起请求并解出首帧首事件，或在吐任何字节前抛错（抛错可安全切号，started 仍 false）
          self.deps.health.recordSuccess(lease.id)
          if (ctx.observation) ctx.observation.accountId = lease.id
          const _hint = ctx.sessionHint
          if (_hint !== undefined) self.deps.selector.remember(_hint, lease.id)
          started = true
          while (next.done !== true) {
            yield next.value
            next = await it.next()
          }
          return
        } catch (err) {
          if (started) throw err // 已吐首字节 → 不切，错误透出
          const cls = self.deps.inner.classifyError(err)
          await self.penalize(lease.id, cls)
          triedIds.add(lease.id)
          lastError = err
          if (cls === 'FATAL') throw err
          // SERVER 错误：给上游/网络喘息后再切号（±20% jitter 防止多账号同时解冻风暴）。
          if (cls === 'SERVER')
            await self.sleep(Math.round(self.deps.retryDelayMs * (0.8 + self.random() * 0.4)))
        } finally {
          lease.release()
          if (it !== undefined && typeof it.return === 'function') {
            try {
              await it.return()
            } catch {
              /* 忽略回收阶段错误 */
            }
          }
        }
      }
      throw lastError ?? new NoHealthyAccountError('no healthy account available')
    })()
  }

  private selCtx(ir: CanonicalRequest, ctx: UpstreamCtx, triedIds: Set<string>) {
    return {
      ...(ctx.sessionHint !== undefined ? { hint: ctx.sessionHint } : {}),
      triedIds,
      model: ir.model,
    }
  }

  private async pool(): Promise<{ list: PoolCandidate[]; byId: Map<string, KiroAccountInfo> }> {
    const all = await this.deps.accounts.listByPlatform()
    const isPooled = this.deps.isPooled ?? (() => true)
    const getPriority = this.deps.getPriority ?? (() => 0)
    const getConcurrency = this.deps.getConcurrency
    // 反代选号资格 = 在池 + 未挂起 + health 可用（有凭据由 bindAccount 兜底）。
    // 不要求 a.isActive：is_active 是「当前 CLI 切换选中的那个账号」标志（每平台通常仅 1 个），
    // 与反代池无关——池成员都是导入后未切换的 inactive 账号，若要求 active 会把整池过滤空 → 503。
    const usable = all.filter(
      (a) =>
        isPooled(a.id) &&
        a.status !== 'SUSPENDED' &&
        this.deps.health.isAvailable(a.id),
    )
    return {
      list: usable.map((a) => ({
        id: a.id,
        priority: getPriority(a.id),
        ...(getConcurrency !== undefined ? { concurrency: getConcurrency(a.id) } : {}),
        ...(a.lastUsedAt !== undefined ? { lastUsedAt: a.lastUsedAt } : {}),
      })),
      byId: new Map(usable.map((a) => [a.id, a])),
    }
  }

  private async bindAccount(
    ctx: UpstreamCtx,
    id: string,
    account: KiroAccountInfo,
  ): Promise<UpstreamCtx> {
    const cred = await this.deps.credentials.retrieve(id)
    if (cred === null) throw new NoHealthyAccountError(`credential missing for ${id}`)
    const dispatcher = await this.deps.dispatchers.dispatcherForAccount(id)
    return {
      ...ctx,
      account,
      credential: cred,
      ...(dispatcher !== undefined ? { dispatcher } : {}),
    }
  }

  private async penalize(id: string, cls: ErrorClass): Promise<void> {
    if (cls === 'SUSPENDED') {
      this.deps.health.markSuspended(id)
      try {
        await this.deps.accounts.markSuspended(id, 'TEMPORARILY_SUSPENDED')
      } catch {
        /* 持久化失败不阻断切号 */
      }
    } else if (cls === 'QUOTA') {
      // 额度耗尽（402）：冷却该账号到下一次配额重置时间，期间不再选它；拿不到 resetAt 退回默认冷却。
      await this.penalizeQuota(id)
    } else if (cls === 'DEPOOL') {
      // token 永久失效（401/403 刷不出新 token）：直接移出反代池（持久），本轮也熔断防再选。
      this.deps.health.markFailure(id)
      if (this.deps.removeFromPool !== undefined) {
        try {
          await this.deps.removeFromPool(id)
        } catch {
          /* 移池持久化失败不阻断切号 */
        }
      }
    } else if (cls === 'RATE_LIMIT') {
      this.deps.health.markRateLimited(id)
    } else if (cls === 'AUTH' || cls === 'SERVER') {
      this.deps.health.markFailure(id)
    }
    // FATAL 不罚账号
  }

  /** 额度耗尽：解析重置时间（混合：缓存优先 + live），冷却到该时刻；解析失败用默认配额冷却兜底。 */
  private async penalizeQuota(id: string): Promise<void> {
    let resetAt: number | undefined
    if (this.deps.quotaReset !== undefined) {
      try {
        resetAt = await this.deps.quotaReset.resetAtForAccount(id)
      } catch {
        /* 解析失败 → 走兜底 */
      }
    }
    if (resetAt !== undefined) this.deps.health.markQuotaExhaustedUntil(id, resetAt)
    else this.deps.health.markQuotaExhausted(id)
  }
}
