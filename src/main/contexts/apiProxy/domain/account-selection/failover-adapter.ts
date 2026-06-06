// 故障转移装饰器：对 inner adapter 套上"多账号选择 + 切号重试 + 健康标记"。
// 注册进 PlatformRegistry 后，handleRequest 一视同仁调 chat/chatStream，故障转移对上层透明。
import type { PlatformUpstreamAdapter, UpstreamCtx, ModelInfo, ErrorClass } from '../platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../canonical'
import type { AccountPoolSelector, PoolCandidate } from './account-pool-selector'
import type { AccountHealthTracker } from './account-health-tracker'
import type { KiroAccountPort, KiroCredentialPort, KiroDispatcherPort, KiroAccountInfo } from '../../infrastructure/adapters/kiro/kiro-ports'

/** 候选池全不可用（全 suspended/冷却/满载）。映射 HTTP 503。 */
export class NoHealthyAccountError extends Error {
  constructor(message: string) { super(message); this.name = 'NoHealthyAccountError' }
}

export interface FailoverDeps {
  inner: PlatformUpstreamAdapter
  selector: AccountPoolSelector
  health: AccountHealthTracker
  accounts: KiroAccountPort
  credentials: KiroCredentialPort
  dispatchers: KiroDispatcherPort
  maxRetries: number
  /** SERVER 类错误切号前等待时长（ms），给上游喘息。默认 100ms。实际等待加 ±20% jitter。 */
  retryDelayMs: number
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

  get platform(): string { return this.deps.inner.platform }
  supportsModel(model: string): boolean { return this.deps.inner.supportsModel(model) }
  listModels(): ModelInfo[] { return this.deps.inner.listModels() }
  classifyError(err: unknown): ErrorClass { return this.deps.inner.classifyError(err) }

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
        const _hint = ctx.sessionHint; if (_hint !== undefined) this.deps.selector.remember(_hint, lease.id)
        return resp
      } catch (err) {
        const cls = this.deps.inner.classifyError(err)
        await this.penalize(lease.id, cls)
        triedIds.add(lease.id)
        lastError = err
        if (cls === 'FATAL') throw err
        // SERVER 错误：给上游/网络喘息后再切号（±20% jitter 防止多账号同时解冻风暴）。
        if (cls === 'SERVER') await this.sleep(Math.round(this.deps.retryDelayMs * (0.8 + this.random() * 0.4)))
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
          let next = await it.next()          // 首个 event：inner 已发起请求并解出首帧首事件，或在吐任何字节前抛错（抛错可安全切号，started 仍 false）
          self.deps.health.recordSuccess(lease.id)
          if (ctx.observation) ctx.observation.accountId = lease.id
          const _hint = ctx.sessionHint; if (_hint !== undefined) self.deps.selector.remember(_hint, lease.id)
          started = true
          while (next.done !== true) { yield next.value; next = await it.next() }
          return
        } catch (err) {
          if (started) throw err              // 已吐首字节 → 不切，错误透出
          const cls = self.deps.inner.classifyError(err)
          await self.penalize(lease.id, cls)
          triedIds.add(lease.id)
          lastError = err
          if (cls === 'FATAL') throw err
          // SERVER 错误：给上游/网络喘息后再切号（±20% jitter 防止多账号同时解冻风暴）。
          if (cls === 'SERVER') await self.sleep(Math.round(self.deps.retryDelayMs * (0.8 + self.random() * 0.4)))
        } finally {
          lease.release()
          if (it !== undefined && typeof it.return === 'function') {
            try { await it.return() } catch { /* 忽略回收阶段错误 */ }
          }
        }
      }
      throw lastError ?? new NoHealthyAccountError('no healthy account available')
    })()
  }

  private selCtx(ir: CanonicalRequest, ctx: UpstreamCtx, triedIds: Set<string>) {
    return { ...(ctx.sessionHint !== undefined ? { hint: ctx.sessionHint } : {}), triedIds, model: ir.model }
  }

  private async pool(): Promise<{ list: PoolCandidate[]; byId: Map<string, KiroAccountInfo> }> {
    const all = await this.deps.accounts.listByPlatform()
    const usable = all.filter((a) => a.isActive && a.status !== 'SUSPENDED' && this.deps.health.isAvailable(a.id))
    return {
      list: usable.map((a) => ({ id: a.id, ...(a.lastUsedAt !== undefined ? { lastUsedAt: a.lastUsedAt } : {}) })),
      byId: new Map(usable.map((a) => [a.id, a])),
    }
  }

  private async bindAccount(ctx: UpstreamCtx, id: string, account: KiroAccountInfo): Promise<UpstreamCtx> {
    const cred = await this.deps.credentials.retrieve(id)
    if (cred === null) throw new NoHealthyAccountError(`credential missing for ${id}`)
    const dispatcher = await this.deps.dispatchers.dispatcherForAccount(id)
    return { ...ctx, account, credential: cred, ...(dispatcher !== undefined ? { dispatcher } : {}) }
  }

  private async penalize(id: string, cls: ErrorClass): Promise<void> {
    if (cls === 'SUSPENDED') {
      this.deps.health.markSuspended(id)
      try { await this.deps.accounts.markSuspended(id, 'TEMPORARILY_SUSPENDED') } catch { /* 持久化失败不阻断切号 */ }
    } else if (cls === 'RATE_LIMIT') {
      this.deps.health.markRateLimited(id)
    } else if (cls === 'AUTH' || cls === 'SERVER') {
      this.deps.health.markFailure(id)
    }
    // FATAL 不罚账号
  }
}
