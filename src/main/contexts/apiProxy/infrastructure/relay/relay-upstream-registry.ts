// RelayUpstreamRegistry：从仓储加载所有 enabled 上游，实例化为 RelayAdapter 列表。
// container 后续将这些 adapter 注册进 PlatformRegistry。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
// 禁：class-property 箭头；禁动态 import()。
import { RelayAdapter } from '../adapters/relay/relay-adapter'
import { createRelayCodec } from '../adapters/relay/codec-factory'
import type { RelayUpstreamRepository } from './relay-upstream.repository'
import type { RelayUpstreamClient } from '../adapters/relay/relay-upstream-client'

export interface RelayUpstreamRegistryDeps {
  repository: RelayUpstreamRepository
  client: RelayUpstreamClient
}

/** 从仓储构建全部 enabled 上游的 RelayAdapter 列表。 */
export class RelayUpstreamRegistry {
  private readonly repository: RelayUpstreamRepository
  private readonly client: RelayUpstreamClient

  constructor(deps: RelayUpstreamRegistryDeps) {
    this.repository = deps.repository
    this.client = deps.client
  }

  /**
   * 加载所有 enabled 上游，为每个上游解密 apiKey 并实例化 RelayAdapter。
   * platform 名格式：`relay-<id>`。
   */
  async buildAdapters(): Promise<RelayAdapter[]> {
    const records = await this.repository.list()
    const enabled = records.filter((r) => r.enabled)
    const adapters: RelayAdapter[] = []

    for (const rec of enabled) {
      const apiKey = await this.repository.resolveApiKey(rec.id)
      const codec = createRelayCodec(rec.protocol)
      adapters.push(
        new RelayAdapter({
          platform: `relay-${rec.id}`,
          baseUrl: rec.baseUrl,
          apiKey,
          models: rec.models,
          client: this.client,
          codec,
        }),
      )
    }

    return adapters
  }
}
