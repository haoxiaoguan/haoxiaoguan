// 中转注入专用「固定注入 key」。
//
// 号小管做「中转注入」(Codex / relay 聚合)时，注入到客户端配置里的不是普通客户端 Key，而是这把
// 固定、隐藏、仅本地的 key。反代鉴权识别到它 → 标记请求为「注入来源」(injectionOrigin)：
// 一律按真实模型名直连真实上游(native→登录账号 / relay→relay / 池→池)，**不走路由组合**——
// 避免同名组合劫持 Codex 等的原生模型(用协议/responses 区分已不可靠，故改用 key 区分)。
//
// 特性：① 不进「客户端 Key」列表(独立存储，不经 ApiProxyKeyService)；② 仅本地(loopback)可用
// (鉴权层强制)；③ 稳定持久(注入进配置后不能变，否则客户端失联)。

/** 单值密钥读写（与 sync 的 SecretStore 同形，避免跨上下文 import 具体类）。 */
export interface InjectionKeyStore {
  get(): Promise<string | null>
  set(value: string): Promise<void>
}

export class RelayInjectionKeyService {
  private cached: string | null = null

  constructor(
    private readonly store: InjectionKeyStore,
    /** 生成新 key（container 注入，基于 crypto 随机；隔离随机源便于测试）。 */
    private readonly generate: () => string,
  ) {}

  /** 取固定注入 key：已存在直接返回，否则生成并持久化（首次幂等）。 */
  async get(): Promise<string> {
    if (this.cached !== null) return this.cached
    const existing = await this.store.get()
    if (existing !== null && existing.trim().length > 0) {
      this.cached = existing
      return existing
    }
    const key = this.generate()
    await this.store.set(key)
    this.cached = key
    return key
  }
}
