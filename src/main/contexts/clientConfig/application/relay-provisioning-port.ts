// relay-provisioning-port.ts
// clientConfig 用它把「需走反代的第三方」登记成 relay 上游；实现在 container（连 apiProxy relay 仓储）。
// bytecode 安全：无 class-property 箭头初始化，禁动态 import()。
import type { WireProtocol } from '../domain/protocol-routing'

/**
 * openai-responses 透传的模型别名条目。
 * alias：catalog slug（暴露给 Codex）；real：上游真实 model id。
 * alias===real 时表示无别名（直接用原名）。
 */
export interface RelayModelAlias {
  alias: string
  real: string
}

/** clientConfig 用它把「需走反代的第三方」登记成 relay 上游;实现在 container(连 apiProxy relay 仓储)。 */
export interface RelayProvisioningPort {
  /** 为接入档建/更新对应 relay 上游并热重载反代;返回该上游在反代里的 platform 名(如 'relay-<id>')。 */
  ensureRelayUpstream(input: {
    profileId: string
    displayName: string
    /** 第三方上游说的协议。 */
    protocol: WireProtocol
    baseUrl: string
    apiKey: string
    /**
     * 客户端要用的模型列表。
     * - 非 responses 协议：string[]（模型 id 列表）。
     * - openai-responses 协议：RelayModelAlias[]（含 alias→real 映射）。
     * 两种形式都被 container 实现处理。
     */
    models: string[] | RelayModelAlias[]
  }): Promise<{ platform: string }>
  /** 删除接入档时清理其 relay 上游并热重载。 */
  removeRelayUpstream(profileId: string): Promise<void>
}
