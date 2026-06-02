// 平台注册表：按 platform 名持有 PlatformUpstreamAdapter，集中表达「锁池」与「模型感知选池」两种选择。
// 纯内存结构，启动时由 container 注册各适配器（M2b 仅 Echo）。
import type { PlatformUpstreamAdapter, ModelInfo } from '../domain/platform-adapter'
import type { RequestIntent } from '../domain/request-intent'

/** 注册表选不到上游时抛此错；handleRequest 捕获后映射为 404 错误体。 */
export class NoUpstreamError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'NoUpstreamError'
  }
}

export class PlatformRegistry {
  private readonly adapters = new Map<string, PlatformUpstreamAdapter>()

  /** 注册一个平台适配器；平台名重复则覆盖（后注册者胜，便于测试替换）。 */
  register(adapter: PlatformUpstreamAdapter): void {
    this.adapters.set(adapter.platform, adapter)
  }

  /** 按平台名取适配器；不存在返回 undefined。 */
  get(platform: string): PlatformUpstreamAdapter | undefined {
    return this.adapters.get(platform)
  }

  /** 已注册的平台名集合（喂 parseRequestIntent 的 knownPlatforms）。 */
  knownPlatforms(): ReadonlySet<string> {
    return new Set(this.adapters.keys())
  }

  /** 找出所有声明支持该模型的平台适配器（注册顺序）。 */
  findPlatformsForModel(model: string): PlatformUpstreamAdapter[] {
    const out: PlatformUpstreamAdapter[] = []
    for (const a of this.adapters.values()) {
      if (a.supportsModel(model)) out.push(a)
    }
    return out
  }

  /**
   * 按路由意图选适配器：
   * - intent.platform 已给（/{platform}/v1 锁池）→ 取该平台；不存在或（chat 类请求且不支持该模型）→ NoUpstreamError。
   * - 裸路由（无 platform）→ 用 intent.model 做模型感知：findPlatformsForModel 首个匹配；无匹配 → NoUpstreamError。
   *   （spec §5：v1 多平台支持同模型的仲裁留未来，取首个匹配。）
   * - models/health 不经此函数选择（由 handleRequest 直接处理）。
   */
  selectAdapter(intent: RequestIntent): PlatformUpstreamAdapter {
    if (intent.platform !== undefined) {
      const a = this.adapters.get(intent.platform)
      if (!a) throw new NoUpstreamError(`unknown platform: ${intent.platform}`)
      if (intent.model !== undefined && !a.supportsModel(intent.model)) {
        throw new NoUpstreamError(`platform ${intent.platform} does not support model: ${intent.model}`)
      }
      return a
    }
    const model = intent.model
    if (model === undefined) throw new NoUpstreamError('no model in request for model-aware routing')
    const matches = this.findPlatformsForModel(model)
    if (matches.length === 0) throw new NoUpstreamError(`no upstream platform supports model: ${model}`)
    return matches[0]
  }

  /** 聚合模型列表：platform 给则仅该平台，否则所有平台（去重按 id，先注册者胜）。 */
  listAllModels(platform?: string): ModelInfo[] {
    const seen = new Set<string>()
    const out: ModelInfo[] = []
    const sources = platform !== undefined
      ? (this.adapters.has(platform) ? [this.adapters.get(platform)!] : [])
      : Array.from(this.adapters.values())
    for (const a of sources) {
      for (const m of a.listModels()) {
        if (!seen.has(m.id)) {
          seen.add(m.id)
          out.push(m)
        }
      }
    }
    return out
  }
}
