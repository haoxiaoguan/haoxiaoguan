// KiroModelCatalog：/v1/models 与客户端接入目录的 kiro 模型「实时」来源。
//
// 设计（按需求锁定）：
//  - 单一内存快照（账号无关）：启动后台预热 + 手动刷新才重建，否则一直沿用（不随每次请求打上游）。
//  - 取数账号：当前可用账号里「会员档位最高」者（高档位通常解锁更多模型）。
//  - 内容：上游 ListAvailableModels 纯替代；拉不到/空 → 回退硬编码（fallbackModels）。
//  - 服务期门控（同步、不打上游）：此刻无可用账号 → 返回 []（kiro 不下发，修「无账号仍下发」缺陷）。
//    可用 = 池内 + isActive + 非 SUSPENDED + 运行态 available（确定性 snapshot，不走半开随机）。
//  - roster（账号名册）随预热/手动刷新缓存；health 实时（同步）读 → 门控对冷却/挂起即时反映。
//
// 禁：class-property 箭头初始化；禁动态 import()。
import { fetchAvailableModels } from '../../../../../platform/net/kiro/kiro-identity-client'
import type { FetchImpl, KiroModelInfo } from '../../../../../platform/net/kiro/kiro-identity-client'
import { resolveKiroModelFetchParams } from './kiro-account-fingerprint'
import { kiroPlanRank } from './kiro-plan-rank'
import type { KiroAccountPort, KiroAccountInfo, KiroCredentialPort } from './kiro-ports'
import type { AccountHealthTracker } from '../../../domain/account-selection/account-health-tracker'
import type { ModelInfo } from '../../../domain/platform-adapter'

export interface KiroModelCatalogDeps {
  accounts: KiroAccountPort
  health: AccountHealthTracker
  credentials: KiroCredentialPort
  /** 账号池成员门控（与 FailoverAdapter 同源：仅池内账号可被反代）。 */
  isPooled: (id: string) => boolean
  /** 回退清单（= kiro 硬编码模型，通常注入 KiroAdapter.listModels）。拉不到上游时用。 */
  fallbackModels: () => ModelInfo[]
  /**
   * 是否可被 adapter 实际路由（= KiroAdapter.supportsModel）。注入后，快照只保留可路由模型，
   * 保证「/v1/models 列出即可调用」——避免上游 ListAvailableModels 含 adapter 不支持的模型
   * （如 auto/deepseek/glm/qwen）被下发后调用即 404。不注入则不过滤（向后兼容）。
   */
  canServe?: (modelId: string) => boolean
  /** 注入 fetch（测试用）。 */
  fetchImpl?: FetchImpl
}

export class KiroModelCatalog {
  private snapshot: ModelInfo[] | null = null
  private roster: KiroAccountInfo[] = []
  private warming: Promise<void> | null = null

  constructor(private readonly deps: KiroModelCatalogDeps) {}

  /**
   * 服务期取 kiro 模型（同步、不打上游）。供 /v1/models 与客户端目录共用：
   *  - 此刻无可用账号 → []（严格门控）。
   *  - 有可用账号 → 快照；快照未预热则触发一次后台预热，本次先用 fallback（不阻塞、不丢 kiro）。
   */
  listForServe(): ModelInfo[] {
    if (!this.hasUsableAccount()) return []
    if (this.snapshot !== null) return this.snapshot
    if (this.warming === null) void this.warm(false)
    return this.deps.fallbackModels()
  }

  /**
   * 预热 / 手动刷新。
   *  - force=false（启动/惰性）：刷新 roster；仅当快照为空才重建快照。
   *  - force=true（手动刷新）：刷新 roster 并强制重建快照。
   * 并发去重：同一时刻仅一个预热在跑。
   */
  async warm(force = false): Promise<void> {
    if (this.warming !== null) {
      await this.warming
      if (!force) return
    }
    const run = this.doWarm(force)
    this.warming = run
    try {
      await run
    } finally {
      if (this.warming === run) this.warming = null
    }
  }

  /** 手动刷新别名（强制重建）。 */
  refresh(): Promise<void> {
    return this.warm(true)
  }

  private async doWarm(force: boolean): Promise<void> {
    this.roster = await this.deps.accounts.listByPlatform()
    if (!force && this.snapshot !== null) return

    const acct = this.pickTopAccount()
    if (acct === null) {
      // 无可用账号：不写快照（保持原值/为空），服务期门控会隐藏 kiro。
      return
    }
    const cred = await this.deps.credentials.retrieve(acct.id)
    if (cred === null) {
      this.snapshot = this.deps.fallbackModels()
      return
    }
    const params = resolveKiroModelFetchParams(acct, cred)
    let raw: KiroModelInfo[] = []
    try {
      raw = await fetchAvailableModels(params, { fetchImpl: this.deps.fetchImpl })
    } catch {
      raw = []
    }
    const mapped = raw.map(toModelInfo).filter((m) => m.id.length > 0)
    // 收口：只保留 adapter 能实际路由的模型（canServe=KiroAdapter.supportsModel），
    // 保证「下发清单 == 可路由集」——上游可能含 adapter 不支持的模型（auto/deepseek/glm/qwen），
    // 下发后调用会 404。过滤后若为空（live 全不可路由）→ 回退硬编码（claude）。
    const servable =
      this.deps.canServe !== undefined ? mapped.filter((m) => this.deps.canServe!(m.id)) : mapped
    // 纯替代：拉到非空 → 用 live；否则回退硬编码（账号存在但上游拉取失败/空/全不可路由）。
    this.snapshot = servable.length > 0 ? servable : this.deps.fallbackModels()
  }

  /** 当前可用账号里会员档位最高者；同档位取最近使用（热账号）。无可用 → null。 */
  private pickTopAccount(): KiroAccountInfo | null {
    const usable = this.roster.filter((a) => this.isUsable(a))
    if (usable.length === 0) return null
    let best = usable[0]
    for (let i = 1; i < usable.length; i++) {
      const a = usable[i]
      const d = kiroPlanRank(a.planName, a.planTier) - kiroPlanRank(best.planName, best.planTier)
      if (d > 0 || (d === 0 && (a.lastUsedAt ?? 0) > (best.lastUsedAt ?? 0))) best = a
    }
    return best
  }

  private hasUsableAccount(): boolean {
    return this.roster.some((a) => this.isUsable(a))
  }

  private isUsable(a: KiroAccountInfo): boolean {
    // 与 FailoverAdapter 选号资格保持一致：在池 + 未挂起 + health 可用。
    // 不要求 a.isActive（CLI 切换标志，与反代池无关），否则「下发清单」会与「实际可路由」不一致。
    return (
      this.deps.isPooled(a.id) &&
      a.status !== 'SUSPENDED' &&
      this.deps.health.snapshot(a.id).runtimeState === 'available'
    )
  }
}

function asObj(v: unknown): Record<string, unknown> | undefined {
  return v !== null && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, unknown>) : undefined
}

function numOrUndef(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined
}

/** KiroModelInfo（ListAvailableModels）→ ModelInfo（/v1/models 形状）。 */
function toModelInfo(m: KiroModelInfo): ModelInfo {
  const tl = asObj(m.tokenLimits)
  const pc = asObj(m.promptCaching)
  const ctx = numOrUndef(tl?.['maxInputTokens'])
  const out = numOrUndef(tl?.['maxOutputTokens'])
  const cache = typeof pc?.['supportsPromptCaching'] === 'boolean' ? (pc['supportsPromptCaching'] as boolean) : undefined
  return {
    id: m.modelId,
    displayName: m.modelName ?? m.modelId,
    ownedBy: 'anthropic',
    supportsThinking: true,
    ...(cache !== undefined ? { supportsPromptCaching: cache } : {}),
    ...(ctx !== undefined ? { contextLength: ctx } : {}),
    ...(out !== undefined ? { maxOutputTokens: out } : {}),
  }
}
