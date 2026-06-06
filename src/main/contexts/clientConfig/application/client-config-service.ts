// 客户端接入档应用服务：编排 store（记录）+ writer 注册表 + applier（写盘）+ 快照（历史/回滚）。
import { existsSync } from 'node:fs'
import { fetch as undiciFetch } from 'undici'
import type { LocalProxyPort, ConnTestResult } from './local-proxy-port'
import type { ClientId, ClientConfigProfile, ClientInfo } from '../domain/client-profile'
import { CLIENT_DISPLAY_NAMES } from '../domain/client-profile'
import type { ApplyInput, ClientConfigWriter } from '../domain/client-writer'
import type { ClientConfigStore, CreateProfileInput, UpdateProfileInput } from './client-config-store'
import type { WriterRegistry } from './writer-registry'
import type { ClientConfigApplier, DiffFile } from './client-config-applier'
import type { ConfigSnapshotStore, SnapshotEntry } from '../infrastructure/config-snapshot'

export class ClientConfigService {
  private readonly store: ClientConfigStore
  private readonly registry: WriterRegistry
  private readonly applier: ClientConfigApplier
  private readonly snapshots: ConfigSnapshotStore
  private readonly localProxy?: LocalProxyPort

  constructor(
    store: ClientConfigStore,
    registry: WriterRegistry,
    applier: ClientConfigApplier,
    snapshots: ConfigSnapshotStore,
    localProxy?: LocalProxyPort,
  ) {
    this.store = store
    this.registry = registry
    this.applier = applier
    this.snapshots = snapshots
    this.localProxy = localProxy
  }

  /** 已注册客户端 + 检测状态（任一配置文件存在）。供 UI pill 切换器。 */
  listClients(): ClientInfo[] {
    return this.registry.clientIds().map((clientId) => {
      const writer = this.registry.get(clientId)
      const detected = writer !== undefined && writer.configFiles().some((f) => existsSync(f))
      return { clientId, displayName: CLIENT_DISPLAY_NAMES[clientId], detected }
    })
  }

  // ---- 记录 CRUD（不碰客户端配置文件）----
  list(clientId?: ClientId): Promise<ClientConfigProfile[]> {
    return this.store.list(clientId)
  }
  create(input: CreateProfileInput): Promise<ClientConfigProfile> {
    return this.store.create(input)
  }
  update(id: string, patch: UpdateProfileInput): Promise<void> {
    return this.store.update(id, patch)
  }
  delete(id: string): Promise<void> {
    return this.store.delete(id)
  }

  // ---- 写盘相关 ----
  /** 预览：纯计算 before/after，不写盘、不快照。 */
  async preview(id: string): Promise<DiffFile[]> {
    const { writer, input } = await this.resolve(id)
    return this.applier.preview(writer, input)
  }

  /** 应用并设为当前生效（switch 语义：写选中档 + 标记 current）。 */
  async apply(id: string): Promise<void> {
    const { profile, writer, input } = await this.resolve(id)
    await this.applier.apply(writer, input, 'switch')
    await this.store.setCurrent(profile.clientId, id)
  }

  /** 还原：从客户端配置移除本接入档（保留记录；不需要 key）。 */
  async clear(id: string): Promise<void> {
    const profile = await this.requireProfile(id)
    const writer = this.requireWriter(profile.clientId)
    await this.applier.clear(writer, id)
  }

  // ---- 本机反代接入（phase3 杀手锏）----
  /** 一键接入本机反代：读端口 → 签发 client key → 拉模型 → 建 local-proxy 接入档并立即启用。 */
  async connectLocalProxy(clientId: ClientId): Promise<ClientConfigProfile> {
    if (this.localProxy === undefined) throw new Error('本机反代接入未配置')
    const port = this.localProxy.getPort()
    if (port === null) throw new Error('本机反代未运行，请先在「API 服务」开启')
    const { id: keyId, plaintext } = await this.localProxy.signKey(`client-config:${clientId}`)
    const models = this.localProxy.listModels()
    const profile = await this.store.create({
      clientId,
      name: '本机反代',
      source: 'local-proxy',
      baseUrl: `http://127.0.0.1:${port}`,
      apiKey: plaintext, // 明文经 store 加密落 key_enc；keyRef 记反代 key id 供吊销
      keyRef: keyId,
      ...(models.length > 0 ? { model: models[0] } : {}),
    })
    await this.apply(profile.id) // 一键 = 建档 + 写入客户端 + 设为当前生效
    return profile
  }

  /** 测连通：用接入档的 baseUrl + key 打 GET /v1/models（绿/红反馈）。 */
  async testConnectivity(id: string): Promise<ConnTestResult> {
    const profile = await this.requireProfile(id)
    const apiKey = await this.store.resolveApiKey(id)
    const url = `${profile.baseUrl.replace(/\/+$/, '')}/v1/models`
    try {
      const res = await undiciFetch(url, { headers: { Authorization: `Bearer ${apiKey}` } })
      return { ok: res.ok, status: res.status }
    } catch (e) {
      return { ok: false, message: e instanceof Error ? e.message : String(e) }
    }
  }

  // ---- 历史/回滚 ----
  history(clientId: ClientId): Promise<SnapshotEntry[]> {
    return this.snapshots.list(clientId)
  }
  rollback(clientId: ClientId, entryId: string): Promise<void> {
    return this.snapshots.restore(clientId, entryId)
  }

  // ---- 内部 ----
  private async requireProfile(id: string): Promise<ClientConfigProfile> {
    const p = await this.store.get(id)
    if (p === null) throw new Error(`接入档不存在: ${id}`)
    return p
  }
  private requireWriter(clientId: ClientId): ClientConfigWriter {
    const w = this.registry.get(clientId)
    if (w === undefined) throw new Error(`未支持的客户端写入器: ${clientId}`)
    return w
  }
  private async resolve(
    id: string,
  ): Promise<{ profile: ClientConfigProfile; writer: ClientConfigWriter; input: ApplyInput }> {
    const profile = await this.requireProfile(id)
    const writer = this.requireWriter(profile.clientId)
    const apiKey = await this.store.resolveApiKey(id)
    const input: ApplyInput = {
      profileId: profile.id,
      source: profile.source,
      baseUrl: profile.baseUrl,
      apiKey,
      ...(profile.model !== undefined ? { model: profile.model } : {}),
    }
    return { profile, writer, input }
  }
}
