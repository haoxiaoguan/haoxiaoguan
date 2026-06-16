// RelayUpstreamRegistry：从仓储加载所有 enabled 上游，实例化为 RelayAdapter 或透传适配器列表。
// container 后续将这些 adapter 注册进 PlatformRegistry。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
// 禁：class-property 箭头；禁动态 import()。
import { RelayAdapter } from '../adapters/relay/relay-adapter'
import { ResponsesPassthroughUpstream } from '../adapters/relay/responses-passthrough-upstream'
import { createRelayCodec } from '../adapters/relay/codec-factory'
import type { RelayUpstreamRepository } from './relay-upstream.repository'
import type { RelayUpstreamClient } from '../adapters/relay/relay-upstream-client'
import type { PlatformUpstreamAdapter } from '../../domain/platform-adapter'

export interface RelayUpstreamRegistryDeps {
  repository: RelayUpstreamRepository
  client: RelayUpstreamClient
}

/** 从仓储构建全部 enabled 上游的适配器列表（RelayAdapter 或 ResponsesPassthroughUpstream）。 */
export class RelayUpstreamRegistry {
  private readonly repository: RelayUpstreamRepository
  private readonly client: RelayUpstreamClient

  constructor(deps: RelayUpstreamRegistryDeps) {
    this.repository = deps.repository
    this.client = deps.client
  }

  /**
   * 加载所有 enabled 上游，为每个上游解密 apiKey 并实例化适配器。
   * - protocol='openai-responses'：实例化 ResponsesPassthroughUpstream（HTTP 级透传，不走 codec）。
   * - 其余（openai/anthropic/gemini）：实例化 RelayAdapter（IR 转换路）。
   * platform 名格式：`relay-<id>`。
   * models 字段支持 alias:real 格式（见 RelayUpstreamRecord.models）：
   *   - ModelInfo.id 作为 alias（catalog slug 暴露给外部）；
   *   - ModelInfo.displayName 若格式为 "alias:real" 则拆解，否则 alias===real。
   */
  async buildAdapters(): Promise<PlatformUpstreamAdapter[]> {
    const records = await this.repository.list()
    const enabled = records.filter((r) => r.enabled)
    const adapters: PlatformUpstreamAdapter[] = []

    for (const rec of enabled) {
      const apiKey = await this.repository.resolveApiKey(rec.id)
      const platform = `relay-${rec.id}`

      if (rec.protocol === 'openai-responses') {
        // responses 透传：不走 codec，HTTP 级原样转发。
        // ModelInfo.id 作为 alias；displayName 若含 ':' 分隔符则取后段为 real，否则 alias===real。
        const modelEntries = rec.models.map((m) => {
          const real = typeof m.displayName === 'string' && m.displayName.includes(':')
            ? m.displayName.split(':').slice(1).join(':')
            : m.id
          return { alias: m.id, real }
        })
        adapters.push(
          new ResponsesPassthroughUpstream({
            platform,
            baseUrl: rec.baseUrl,
            apiKey,
            models: modelEntries,
            client: this.client,
          }),
        )
      } else {
        const codec = createRelayCodec(rec.protocol)
        // 给模型补 ownedBy（缺省用上游 displayName，如 "kimi"）：否则 /v1/models 的
        // owned_by 会命中 buildModelsBody 的 `?? 'kiro'` 兜底，把 relay 模型错标成 kiro。
        const models = rec.models.map((m) => ({
          ...m,
          ...(m.ownedBy === undefined ? { ownedBy: rec.displayName } : {}),
        }))
        adapters.push(
          new RelayAdapter({
            platform,
            baseUrl: rec.baseUrl,
            apiKey,
            models,
            client: this.client,
            codec,
          }),
        )
      }
    }

    return adapters
  }
}
