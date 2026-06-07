// 客户端接入档应用服务：编排 store（记录）+ writer 注册表 + applier（写盘）+ 快照（历史/回滚）。
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fetch as undiciFetch } from 'undici'
import type { LocalProxyPort, ConnTestResult } from './local-proxy-port'
import type { ClientId, ClientConfigProfile, ClientInfo } from '../domain/client-profile'
import { CLIENT_DISPLAY_NAMES, CLIENT_WRITE_MODE } from '../domain/client-profile'
import type { ApplyInput, ClientConfigWriter } from '../domain/client-writer'
import type { ClientConfigStore, CreateProfileInput, UpdateProfileInput } from './client-config-store'
import type { WriterRegistry } from './writer-registry'
import type { ClientConfigApplier, DiffFile } from './client-config-applier'
import type { ConfigSnapshotStore, SnapshotEntry } from '../infrastructure/config-snapshot'

/** 该档是否指定了非空模型(决定能否充当累加式默认指针)。 */
function hasModel(profile: ClientConfigProfile): boolean {
  return profile.model !== undefined && profile.model.length > 0
}

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

  /** 已注册客户端 + 检测状态（任一配置文件存在）。供 UI 左侧客户端列表。 */
  listClients(): ClientInfo[] {
    return this.registry.clientIds().map((clientId) => {
      const writer = this.registry.get(clientId)
      // 检测=客户端配置文件存在 OR 其配置目录存在（如 ~/.codex 仅有 auth.json 也算已接入,
      // 对齐 cc-switch「auth.json 或 config.toml 任一存在即认有效」,避免只登录未配置时漏检）。
      const detected =
        writer !== undefined &&
        writer.configFiles().some((f) => existsSync(f) || existsSync(dirname(f)))
      return {
        clientId,
        displayName: CLIENT_DISPLAY_NAMES[clientId],
        detected,
        writeMode: writer?.writeMode ?? CLIENT_WRITE_MODE[clientId],
      }
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
  async delete(id: string): Promise<void> {
    // local-proxy 档:删档时联动吊销其反代 client key(keyRef),避免 key 与 profile 生命周期脱钩
    // 而积累孤儿凭证。吊销失败不阻塞删除(可在「API 服务」页手动清理)。
    if (this.localProxy !== undefined) {
      const keyRef = await this.store.getKeyRef(id)
      if (keyRef !== null) {
        try {
          await this.localProxy.revokeKey(keyRef)
        } catch {
          // 吊销失败不阻塞删除
        }
      }
    }
    await this.store.delete(id)
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
    // 切换式:还原当前生效档时取消 current；累加式:停用注入标记。
    if (writer.writeMode === 'switch') {
      if (profile.isCurrent) await this.store.setCurrent(profile.clientId, '')
    } else {
      await this.store.setEnabled(id, false)
    }
  }

  // ---- 累加式（共存）----
  /** 启用：把该档注入 live（与其它已启用档共存，不互相覆盖）+ 标记 enabled。
   *  若该客户端尚无默认指针，本次顺带设为默认。switch 客户端等价 apply。 */
  async enable(id: string): Promise<void> {
    const profile = await this.requireProfile(id)
    const writer = this.requireWriter(profile.clientId)
    if (writer.writeMode === 'switch') {
      await this.apply(id)
      return
    }
    const siblings = await this.store.list(profile.clientId)
    const hasDefault = siblings.some((p) => p.isDefault && p.id !== id)
    // 仅当本档指定了模型才有资格当默认指针——无模型档无法构成有效默认(<provider>/<model>），
    // 否则 store 标默认而 live 指针不变,造成 store↔live 静默分叉。
    const makeDefault = (profile.isDefault || !hasDefault) && hasModel(profile)
    const { writer: w, input } = await this.resolve(id, { isDefault: makeDefault })
    await this.applier.apply(w, input, 'apply')
    await this.store.setEnabled(id, true)
    if (makeDefault) await this.store.setDefault(profile.clientId, id)
  }

  /** 停用：从 live 移除该档（保留其它已启用档）+ 清 enabled。 */
  async disable(id: string): Promise<void> {
    const profile = await this.requireProfile(id)
    const writer = this.requireWriter(profile.clientId)
    await this.applier.clear(writer, id)
    await this.store.setEnabled(id, false)
  }

  /** 设默认指针（累加式）：确保该档已注入并改写客户端顶层默认模型，同 client 其余取消默认。 */
  async setDefault(clientId: ClientId, id: string): Promise<void> {
    const profile = await this.requireProfile(id)
    const writer = this.requireWriter(clientId)
    if (writer.writeMode !== 'additive') throw new Error('仅累加式客户端支持默认指针')
    if (!hasModel(profile)) throw new Error('该接入档未指定模型，无法设为默认')
    const { writer: w, input } = await this.resolve(id, { isDefault: true })
    await this.applier.apply(w, input, 'apply')
    await this.store.setEnabled(id, true)
    await this.store.setDefault(clientId, id)
    void profile
  }

  // ---- 本机反代接入（phase3 杀手锏）----
  /** 一键接入本机反代：读端口 → 签发 client key → 拉模型 → 建 local-proxy 接入档并立即启用。 */
  async connectLocalProxy(clientId: ClientId): Promise<ClientConfigProfile> {
    if (this.localProxy === undefined) throw new Error('本机反代接入未配置')
    const port = this.localProxy.getPort()
    if (port === null) throw new Error('本机反代未运行，请先在「API 服务」开启')
    const { id: keyId, plaintext } = await this.localProxy.signKey(`client-config:${clientId}`)
    const models = this.localProxy.listModels()
    // 失败补偿:key 已签发,若后续建档/注入失败(如目标客户端配置损坏拒写),
    // 必须吊销这把 key 并回滚半截 profile,否则积累已授权的孤儿凭证。
    let profile: ClientConfigProfile
    try {
      profile = await this.store.create({
        clientId,
        name: '本机反代',
        source: 'local-proxy',
        baseUrl: `http://127.0.0.1:${port}`,
        apiKey: plaintext, // 明文经 store 加密落 key_enc；keyRef 记反代 key id 供吊销
        keyRef: keyId,
        ...(models.length > 0 ? { model: models[0] } : {}),
      })
    } catch (e) {
      await this.revokeQuietly(keyId)
      throw e
    }
    try {
      await this.enable(profile.id) // 一键 = 建档 + 注入客户端 + 生效(enable 内部按 switch/additive 分流)
    } catch (e) {
      await this.revokeQuietly(keyId)
      try {
        await this.store.delete(profile.id)
      } catch {
        // 回滚 profile 失败可忽略(已吊销 key,无凭证泄漏)
      }
      throw e
    }
    return profile
  }

  /** 吊销反代 key,吞掉吊销本身的错误(用于失败补偿,不让补偿掩盖原始错误)。 */
  private async revokeQuietly(keyId: string): Promise<void> {
    if (this.localProxy === undefined) return
    try {
      await this.localProxy.revokeKey(keyId)
    } catch {
      // 补偿吊销失败可忽略
    }
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
    opts?: { isDefault?: boolean },
  ): Promise<{ profile: ClientConfigProfile; writer: ClientConfigWriter; input: ApplyInput }> {
    const profile = await this.requireProfile(id)
    const writer = this.requireWriter(profile.clientId)
    const apiKey = await this.store.resolveApiKey(id)
    const input: ApplyInput = {
      profileId: profile.id,
      name: profile.name,
      source: profile.source,
      baseUrl: profile.baseUrl,
      apiKey,
      ...(profile.model !== undefined ? { model: profile.model } : {}),
      ...(profile.settings !== undefined ? { settings: profile.settings } : {}),
      ...(opts?.isDefault !== undefined ? { isDefault: opts.isDefault } : {}),
    }
    return { profile, writer, input }
  }
}
