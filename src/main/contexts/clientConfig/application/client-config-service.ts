// 客户端接入档应用服务：编排 store（记录）+ writer 注册表 + applier（写盘）+ 快照（历史/回滚）。
import { existsSync } from 'node:fs'
import { dirname } from 'node:path'
import { fetch as undiciFetch } from 'undici'
import type { LocalProxyPort, ConnTestResult, CatalogModel } from './local-proxy-port'
import type { RelayProvisioningPort, RelayModelAlias } from './relay-provisioning-port'
import type { ClientId, ClientConfigProfile, ClientInfo } from '../domain/client-profile'
import { CLIENT_DISPLAY_NAMES, CLIENT_WRITE_MODE, CLIENT_IDS } from '../domain/client-profile'
import type { ApplyInput, ClientConfigWriter } from '../domain/client-writer'
import type { ClientConfigStore, CreateProfileInput, UpdateProfileInput } from './client-config-store'
import type { WriterRegistry } from './writer-registry'
import type { ClientConfigApplier, DiffFile } from './client-config-applier'
import type { ConfigSnapshotStore, SnapshotEntry } from '../infrastructure/config-snapshot'
import { resolveRelayDecisionForClient } from '../domain/protocol-routing'
import type { WireProtocol } from '../domain/protocol-routing'

/** 该档是否指定了非空模型(决定能否充当累加式默认指针)。 */
function hasModel(profile: ClientConfigProfile): boolean {
  return profile.model !== undefined && profile.model.length > 0
}

/** Codex 模型列表项（来自 settings.codexModels）。 */
interface CodexModelEntry {
  id: string
  name?: string
  contextWindow?: number
}

/**
 * 解析 Codex 模型列表（settings.codexModels）。校验 id 非空字符串、contextWindow 正整数；
 * 非空数组用之；缺失/空则回退 [{ id: fallbackModel }]（无 fallbackModel 则空数组）。
 * 启用(selectCodexProvider)与预览(previewDraft)共用，保证「预览的 catalog」与「写盘的 catalog」一致。
 */
function parseCodexModels(
  settings: Record<string, unknown> | undefined,
  fallbackModel: string | undefined,
): CodexModelEntry[] {
  const raw = settings?.codexModels
  if (Array.isArray(raw) && raw.length > 0) {
    const result: CodexModelEntry[] = []
    for (const item of raw) {
      if (typeof item !== 'object' || item === null) continue
      const o = item as Record<string, unknown>
      if (typeof o.id !== 'string' || o.id.trim().length === 0) continue
      const entry: CodexModelEntry = { id: o.id.trim() }
      if (typeof o.name === 'string' && o.name.trim().length > 0) entry.name = o.name.trim()
      if (typeof o.contextWindow === 'number' && Number.isFinite(o.contextWindow) && o.contextWindow > 0) {
        entry.contextWindow = Math.floor(o.contextWindow)
      }
      result.push(entry)
    }
    if (result.length > 0) return result
  }
  if (fallbackModel !== undefined && fallbackModel.length > 0) {
    return [{ id: fallbackModel }]
  }
  return []
}

/** CodexModelEntry → catalog 输入（{ id, displayName?, contextLength? }）。 */
function codexEntriesToCatalogInputs(
  entries: CodexModelEntry[],
): Array<{ id: string; displayName?: string; contextLength?: number }> {
  return entries.map((e) => ({
    id: e.id,
    ...(e.name !== undefined ? { displayName: e.name } : {}),
    ...(e.contextWindow !== undefined ? { contextLength: e.contextWindow } : {}),
  }))
}

/**
 * L2「中转注入」隐藏聚合路由器的合成档 id（不对应任何 UI 供应商档）。
 * 经 codexProviderId 产出固定 provider 键 hxgcodexrouter，作为 config.toml 顶层 model_provider，
 * 由本机反代按模型名分流（原生→ChatGPT 透传 / 账号池→kiro / 第三方→relay）。
 */
const CODEX_ROUTER_PROFILE_ID = 'codexrouter'

export class ClientConfigService {
  private readonly store: ClientConfigStore
  private readonly registry: WriterRegistry
  private readonly applier: ClientConfigApplier
  private readonly snapshots: ConfigSnapshotStore
  private readonly localProxy?: LocalProxyPort
  private readonly relayProvisioning?: RelayProvisioningPort
  /** 读取 Codex「中转注入」开关:true=真共存(原生+所选供应商), false=切换式(纯 API,只用所选供应商)。 */
  private readonly codexRelayOn: () => boolean

  constructor(
    store: ClientConfigStore,
    registry: WriterRegistry,
    applier: ClientConfigApplier,
    snapshots: ConfigSnapshotStore,
    localProxy?: LocalProxyPort,
    relayProvisioning?: RelayProvisioningPort,
    codexRelayOn?: () => boolean,
  ) {
    this.store = store
    this.registry = registry
    this.applier = applier
    this.snapshots = snapshots
    this.localProxy = localProxy
    this.relayProvisioning = relayProvisioning
    this.codexRelayOn = codexRelayOn ?? (() => false)
  }

  /** 已注册客户端 + 检测状态（任一配置文件存在）。供 UI 左侧客户端列表。
   *  顺序固定按 CLIENT_IDS（claude→codex→gemini→opencode→openclaw→hermes），
   *  与 writer 注册顺序解耦，保证三处列表（客户端管理/接入/会话）展示顺序一致。 */
  listClients(): ClientInfo[] {
    return CLIENT_IDS.map((clientId) => {
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
    // relay 档:删档时联动清理 relay 上游（失败不阻塞删除，与 keyRef 吊销同风格）。
    if (this.relayProvisioning !== undefined) {
      try {
        await this.relayProvisioning.removeRelayUpstream(id)
      } catch {
        // 清理失败不阻塞删除
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

  /**
   * 用表单草稿值 dry-render 预览将写入的配置（不存档、不写盘、不快照）。
   * apiKey 由调用方传明文或留空(留空时配置里 token 字段为空)。relay 改写不在预览阶段发生,
   * 此处展示「直连形态」配置(与 preview(id) 同语义)。
   */
  async previewDraft(input: {
    clientId: ClientId
    name: string
    baseUrl: string
    apiKey?: string
    model?: string
    settings?: Record<string, unknown>
  }): Promise<DiffFile[]> {
    const writer = this.requireWriter(input.clientId)
    // Codex：预览展示直连(OFF)形态——把 UI 的 codexModels 列表映射成 writer 认的 codexCatalogModels，
    // 否则 writer 读不到列表 → catalog 段落退回磁盘旧文件，display_name 失真(不反映用户填的菜单显示名)。
    let settings = input.settings
    if (input.clientId === 'codex') {
      const entries = parseCodexModels(input.settings, input.model)
      if (entries.length > 0) {
        settings = {
          ...(input.settings ?? {}),
          codexCatalogModels: codexEntriesToCatalogInputs(entries),
          codexCatalogIncludeNative: false, // 预览=直连形态，不并原生
        }
      }
    }
    const applyInput: ApplyInput = {
      profileId: 'draft',
      name: input.name,
      source: 'manual',
      baseUrl: input.baseUrl,
      apiKey: input.apiKey ?? '',
      ...(input.model !== undefined && input.model.length > 0 ? { model: input.model } : {}),
      ...(settings !== undefined ? { settings } : {}),
      isDefault: false,
    }
    return this.applier.preview(writer, applyInput)
  }

  /**
   * 拉取供应商模型列表（GET /v1/models）。claude 走 anthropic 头(x-api-key+anthropic-version),
   * 其余走 Bearer。apiKey 为空且给 profileId 时解出已存档明文 key（编辑态用)。解析 data[].id。
   */
  async fetchModels(input: {
    clientId: ClientId
    baseUrl: string
    apiKey?: string
    profileId?: string
  }): Promise<string[]> {
    let key = input.apiKey ?? ''
    if (key.length === 0 && input.profileId !== undefined) {
      try {
        key = await this.store.resolveApiKey(input.profileId)
      } catch {
        // 解 key 失败则用空 key 尝试(部分端点 /models 无需鉴权)
      }
    }
    const base = input.baseUrl.replace(/\/+$/, '')
    const url = /\/v1$/.test(base) ? `${base}/models` : `${base}/v1/models`
    const headers: Record<string, string> =
      input.clientId === 'claude'
        ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' }
        : { Authorization: `Bearer ${key}` }
    const res = await undiciFetch(url, { headers })
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = (await res.json()) as { data?: Array<{ id?: unknown }> }
    if (!Array.isArray(json.data)) return []
    return json.data.map((m) => (typeof m.id === 'string' ? m.id : null)).filter((x): x is string => x !== null)
  }

  /** 应用并设为当前生效（switch 语义：写选中档 + 标记 current）。 */
  async apply(id: string): Promise<void> {
    const { profile, writer, input } = await this.resolveWithRelay(id)
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
    // Codex：单选语义 —— 启用某供应商即把它作为唯一选中(清掉其它)，并按中转注入模式注入。
    if (profile.clientId === 'codex') {
      await this.selectCodexProvider(id)
      return
    }
    if (writer.writeMode === 'switch') {
      await this.apply(id)
      return
    }
    const siblings = await this.store.list(profile.clientId)
    const hasDefault = siblings.some((p) => p.isDefault && p.id !== id)
    // 仅当本档指定了模型才有资格当默认指针——无模型档无法构成有效默认(<provider>/<model>），
    // 否则 store 标默认而 live 指针不变,造成 store↔live 静默分叉。
    const makeDefault = (profile.isDefault || !hasDefault) && hasModel(profile)
    const { writer: w, input } = await this.resolveWithRelay(id, { isDefault: makeDefault })
    await this.applier.apply(w, input, 'apply')
    await this.store.setEnabled(id, true)
    if (makeDefault) await this.store.setDefault(profile.clientId, id)
  }

  /** 停用：从 live 移除该档（保留其它已启用档）+ 清 enabled。 */
  async disable(id: string): Promise<void> {
    const profile = await this.requireProfile(id)
    if (profile.clientId === 'codex') {
      await this.clearCodexProvider(id)
      return
    }
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
    // 联动自动开启 API 服务：未运行则启动后取端口（与第三方路由开关一致,免去手动去「API 服务」开启）。
    let port: number
    try {
      port = await this.localProxy.ensureStarted()
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      throw new Error(`无法自动开启 API 服务：${reason}`)
    }
    const { id: keyId, plaintext } = await this.localProxy.signKey(`client-config:${clientId}`)
    const models = this.localProxy.listModels()
    // Codex 经反代须带 /v1：其 provider base_url + wire_api='responses' → POST {base_url}/responses，
    // 而反代路由裸 /v1/responses（模型感知路由：原生→透传 ChatGPT、Claude→账号池、第三方→relay）。
    // 其余客户端（Claude/Gemini SDK）自行追加 /v1/*，base_url 不带 /v1。
    const baseUrl =
      clientId === 'codex' ? `http://127.0.0.1:${port}/v1` : `http://127.0.0.1:${port}`
    // 失败补偿:key 已签发,若后续建档/注入失败(如目标客户端配置损坏拒写),
    // 必须吊销这把 key 并回滚半截 profile,否则积累已授权的孤儿凭证。
    let profile: ClientConfigProfile
    try {
      profile = await this.store.create({
        clientId,
        name: '号小管账号',
        source: 'local-proxy',
        baseUrl,
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

  // ---- Codex 供应商接入（单选 + 「中转注入」=原生共存开关）----
  // 语义：供应商列表单选(一次只一个「使用中」)。号小管账号也只是其中一个供应商(模型来自账号池 Claude)。
  //   - 中转注入 OFF(切换式)：Codex 纯 API 接入所选供应商，菜单**只含该供应商模型**(原生被替换)。
  //   - 中转注入 ON(真共存)：Codex 原生模型(ChatGPT 账号)与所选供应商模型**共存**。

  /** 「中转注入」开关切换后(渲染端已持久化 setting)，按新模式重注入当前选中的供应商；无选中则清理残留。 */
  async setCodexRelayInjection(_enabled: boolean): Promise<void> {
    const current = (await this.store.list('codex')).find((p) => p.enabled)
    if (current !== undefined) {
      await this.selectCodexProvider(current.id)
    } else {
      try {
        await this.applier.clear(this.requireWriter('codex'), CODEX_ROUTER_PROFILE_ID)
      } catch {
        /* 清理旧版隐藏路由器残留(若有) */
      }
    }
  }

  /** 启停某 Codex 供应商：启用=单选注入它；停用=清除其注入。 */
  async setCodexProviderEnabled(id: string, enabled: boolean): Promise<void> {
    if (enabled) await this.selectCodexProvider(id)
    else await this.clearCodexProvider(id)
  }

  /** 找已存在的号小管账号档（local-proxy 源）。 */
  private async findCodexAccountProfile(): Promise<ClientConfigProfile | null> {
    const list = await this.store.list('codex')
    return list.find((p) => p.source === 'local-proxy') ?? null
  }

  /**
   * 单选注入某 Codex 供应商（requires_openai_auth 恒 true，登录显示由 auth.json 驱动与其无关）：
   *   - 先清掉其它供应商(及旧隐藏路由器)的注入(单选)；
   *   - OFF → 直连该供应商(catalog 只含其模型，原生被替换)。仅限 responses 协议上游——
   *           Codex 只会说 Responses(wire_api=chat 已被上游移除)，非 responses 上游直连必坏，
   *           启用时直接报错提示用户开启「中转注入」(用户拍板：提示而非静默转换)；
   *   - ON  → 原生 + 该供应商模型共存(catalog=原生+其模型)。
   *           号小管账号/可中转第三方经本机反代裸 /v1 按模型名路由(原生 gpt 透传 + 供应商走 relay)；
   *           responses 协议第三方暂退直连(catalog 不并原生，避免原生条目误路由到第三方；
   *           C3 将补 responses 透传把 ON 一律收编进反代实现真共存)。
   */
  private async selectCodexProvider(id: string): Promise<void> {
    const profile = await this.requireProfile(id)
    const relayOn = this.codexRelayOn()
    const writer = this.requireWriter('codex')

    // 单选：清掉其它已启用供应商的注入 + 标记停用；并清旧隐藏路由器残留。
    for (const p of await this.store.list('codex')) {
      if (p.id !== id && p.enabled) {
        try {
          await this.applier.clear(writer, p.id)
        } catch {
          /* 忽略 */
        }
        await this.store.setEnabled(p.id, false)
        await this.revokeCodexRelayKey(p) // 注入移除=其中转 client key 同步失效
      }
    }
    try {
      await this.applier.clear(writer, CODEX_ROUTER_PROFILE_ID)
    } catch {
      /* 忽略旧路由器残留 */
    }

    // 构建注入坐标 + 模型清单。viaProxy=请求经号小管反代(决定 catalog 能否并入原生：
    // 只有反代能按模型路由「原生→ChatGPT 透传/供应商→上游」，直连时并入原生会把原生请求打到第三方)。
    let baseUrl: string
    let apiKey: string
    let models: CatalogModel[]
    let viaProxy: boolean
    if (profile.source === 'local-proxy') {
      // 号小管账号：经本机反代(账号池 Claude；ON 时反代还透传原生 gpt)。
      if (this.localProxy === undefined) throw new Error('本机反代接入未配置')
      const port = await this.ensureProxyPort()
      baseUrl = `http://127.0.0.1:${port}/v1`
      apiKey = await this.store.resolveApiKey(id)
      // 账号池(Claude) + 启用组合(cb/<name>)。组合用显式前缀与同名原生(裸名→登录账号)消歧；
      // ON 时本分支并入原生(codexCatalogIncludeNative)，故三者(原生/组合/账号池)在 catalog 各有其名。
      models = [
        ...this.localProxy.listAccountPoolModels(),
        ...(this.localProxy.listCombos?.() ?? []),
      ]
      viaProxy = true
    } else {
      const proto = (profile.settings?.upstreamProtocol as WireProtocol | undefined) ?? 'openai-chat'
      // 解析多模型列表（settings.codexModels 有则用之；缺失/空则回退 profile.model）
      const codexEntries = parseCodexModels(profile.settings, profile.model)
      if (proto !== 'openai-responses') {
        // 非 responses 上游：Codex 只会说 Responses(wire_api=chat 已被上游移除)，直连必坏。
        if (!relayOn) {
          throw new Error('该供应商上游不是 Responses 协议，Codex 仅支持 Responses；请先开启「中转注入」，由号小管反代转换协议后再启用。')
        }
        if (this.localProxy === undefined || this.relayProvisioning === undefined) {
          throw new Error('中转能力未配置，无法接入非 Responses 协议的供应商')
        }
        // ON + 可中转：经本机反代裸 /v1 按模型名路由(原生 gpt 透传 + 本供应商走 relay)，共存。
        // RelayAdapter 不支持模型映射（alias→real），此分支直接用真名列表传 models：
        // 若第三方模型 id 与原生 slug 撞名，会被 catalog 现有 nativeSlugs filter 跳过（维持现状，不做别名）。
        const port = await this.ensureProxyPort()
        const tpKey = await this.store.resolveApiKey(id)
        await this.relayProvisioning.ensureRelayUpstream({
          profileId: id,
          displayName: profile.name,
          protocol: proto,
          baseUrl: profile.baseUrl,
          apiKey: tpKey,
          models: codexEntries.map((e) => e.id),
        })
        baseUrl = `http://127.0.0.1:${port}/v1`
        apiKey = await this.ensureCodexRelayClientKey(id) // 反代鉴权要求有效 client key(无 loopback 匿名)
        viaProxy = true
        models = codexEntries.map((e) => ({ id: e.id, displayName: e.name ?? `${e.id} · 号小管中转`, ...(e.contextWindow !== undefined ? { contextLength: e.contextWindow } : {}) }))
      } else {
        // responses 协议（C3）：ON+可用反代 → 收编进反代（responses 透传适配器），实现与原生真共存；
        // OFF 或反代不可用 → 直连该第三方端点（catalog 不并原生，避免原生条目误路由）。
        if (relayOn && this.localProxy !== undefined && this.relayProvisioning !== undefined) {
          const port = await this.ensureProxyPort()
          const tpKey = await this.store.resolveApiKey(id)
          // 撞名别名：ON 时 catalog 并原生，若第三方模型 id 与原生 slug 同名，用 <id>-hxg 作 alias
          // 避免 catalog 重复条目/路由歧义；display_name 保持不变（仍含「号小管」后缀）。
          // OFF 时直连不走这里，维持原名（由下方 else 处理）。
          const nativeSlugs = this.getNativeSlugs()
          // 对列表每个 id 做撞名检测；撞名者 alias=<id>-hxg，不撞名者 alias===id
          const relayModels: RelayModelAlias[] = codexEntries.map((e) => ({
            alias: nativeSlugs.has(e.id) ? `${e.id}-hxg` : e.id,
            real: e.id,
          }))
          await this.relayProvisioning.ensureRelayUpstream({
            profileId: id,
            displayName: profile.name,
            protocol: 'openai-responses',
            baseUrl: profile.baseUrl,
            apiKey: tpKey,
            models: relayModels,
          })
          baseUrl = `http://127.0.0.1:${port}/v1`
          apiKey = await this.ensureCodexRelayClientKey(id) // 反代鉴权要求有效 client key(无 loopback 匿名)
          viaProxy = true
          // catalog slug 用 alias（可能有 -hxg 后缀避撞名）；display_name 用用户填写的 name，缺省
          // 用「真实模型名 · 号小管中转」——去掉 -hxg/（号小管），与账号(· 号小管账号)/组合(· 号小管组合)统一。
          models = relayModels.map((rm, i) => ({
            id: rm.alias,
            displayName: codexEntries[i]?.name ?? `${rm.real} · 号小管中转`,
            ...(codexEntries[i]?.contextWindow !== undefined ? { contextLength: codexEntries[i].contextWindow } : {}),
          }))
        } else {
          // OFF 或反代不可用：直连该第三方端点，catalog 不并原生。
          baseUrl = profile.baseUrl
          apiKey = await this.store.resolveApiKey(id)
          viaProxy = false
          models = codexEntriesToCatalogInputs(codexEntries)
        }
      }
    }

    // 默认模型优先取 catalog 里的(账号池/本供应商首个)，避免沿用旧档残留(如 echo-1)。
    const defaultModel = models[0]?.id ?? (profile.model !== undefined && profile.model.length > 0 ? profile.model : undefined)
    const input: ApplyInput = {
      profileId: id,
      name: profile.name,
      source: profile.source,
      baseUrl,
      apiKey,
      ...(defaultModel !== undefined ? { model: defaultModel } : {}),
      settings: {
        ...(profile.settings ?? {}),
        codexCatalogModels: models, // 本供应商模型
        codexCatalogIncludeNative: relayOn && viaProxy, // 仅「ON 且经反代」才并原生(直连并原生=误路由)
      },
      isDefault: true,
    }
    await this.applier.apply(writer, input, 'apply')
    await this.store.setEnabled(id, true)
    await this.store.setDefault('codex', id)
  }

  /** 清除某 Codex 供应商的注入(单选下=取消选中)。 */
  private async clearCodexProvider(id: string): Promise<void> {
    const writer = this.requireWriter('codex')
    await this.applier.clear(writer, id)
    await this.store.setEnabled(id, false)
    const profile = await this.store.get(id)
    if (profile !== null) await this.revokeCodexRelayKey(profile) // 注入移除=中转 client key 同步失效
  }

  /**
   * ON 中转：为该档签发一把反代 client key（写进 experimental_bearer_token）。
   * 反代鉴权要求有效 key（无 loopback 匿名放行，占位符会 401）。每次启用签新并吊销旧的
   * （keyRef 跟踪、至多一把存活）；删档/停用走 revokeCodexRelayKey 联动吊销。
   */
  private async ensureCodexRelayClientKey(id: string): Promise<string> {
    if (this.localProxy === undefined) throw new Error('本机反代接入未配置')
    // 中转注入改用「固定注入 key」（隐藏、不进 client key 列表、仅本地）→ 反代识别后直连真实上游
    // （原生→登录账号 / 第三方→relay），**不走路由组合**。顺手吊销旧版每档签发的 listed key 并清 keyRef。
    const oldRef = await this.store.getKeyRef(id)
    if (oldRef !== null) {
      await this.revokeQuietly(oldRef)
      await this.store.update(id, { keyRef: null })
    }
    return this.localProxy.getRelayInjectionKey()
  }

  /** 吊销 manual 档的中转 client key 并清 keyRef。local-proxy 档的 keyRef 是其主 key（与档同生命周期），不在此吊销。 */
  private async revokeCodexRelayKey(profile: ClientConfigProfile): Promise<void> {
    if (profile.source !== 'manual') return
    const ref = await this.store.getKeyRef(profile.id)
    if (ref === null) return
    await this.revokeQuietly(ref)
    try {
      await this.store.update(profile.id, { keyRef: null })
    } catch {
      // 清引用失败不阻塞（key 已吊销，残留引用无害）
    }
  }

  /**
   * 获取当前已知的原生（ChatGPT 登录账号）模型 slug 集合。
   * 供 ON+responses 分支检测撞名，决定是否需要 -hxg 别名。
   * localProxy 未配置或不支持该方法时返回空 Set（保守：不做别名，直接用原名）。
   */
  private getNativeSlugs(): Set<string> {
    if (this.localProxy === undefined || typeof this.localProxy.listNativeModelSlugs !== 'function') {
      return new Set()
    }
    return new Set(this.localProxy.listNativeModelSlugs())
  }

  /** 启动反代并取端口(包装错误信息)。 */
  private async ensureProxyPort(): Promise<number> {
    if (this.localProxy === undefined) throw new Error('本机反代接入未配置')
    try {
      return await this.localProxy.ensureStarted()
    } catch (e) {
      throw new Error(`无法自动开启 API 服务：${e instanceof Error ? e.message : String(e)}`)
    }
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
    const settings = profile.settings
    const input: ApplyInput = {
      profileId: profile.id,
      name: profile.name,
      source: profile.source,
      baseUrl: profile.baseUrl,
      apiKey,
      ...(profile.model !== undefined ? { model: profile.model } : {}),
      ...(settings !== undefined ? { settings } : {}),
      ...(opts?.isDefault !== undefined ? { isDefault: opts.isDefault } : {}),
    }
    return { profile, writer, input }
  }

  /**
   * 在 resolve 基础上，对 manual 档做「relay 改写」：
   * - 协议不匹配（resolveRelayDecisionForClient==='relay'）→ 强制走反代
   * - 协议匹配但用户主动开启 settings.routeViaProxy===true → 也走反代
   * - 走反代时联动自动开启 API 服务（反代未运行则启动它），改写 baseUrl/apiKey 指向反代
   * - 否则（direct / 非 manual / 无 upstreamProtocol / 未注入 relayProvisioning）→ 原样返回
   */
  private async resolveWithRelay(
    id: string,
    opts?: { isDefault?: boolean },
  ): Promise<{ profile: ClientConfigProfile; writer: ClientConfigWriter; input: ApplyInput }> {
    const base = await this.resolve(id, opts)
    const { profile, writer, input } = base

    // 只对 manual 档且 settings.upstreamProtocol 存在才考虑 relay 分流
    const upstreamProtocol = profile.settings?.upstreamProtocol as WireProtocol | undefined
    const routeViaProxy = profile.settings?.routeViaProxy === true
    const mismatch =
      upstreamProtocol !== undefined &&
      resolveRelayDecisionForClient(profile.clientId, upstreamProtocol) === 'relay'
    // openai-responses 暂无出站 relay codec → 无法中转,强制直连(Codex 直接指向其端点)。
    // 否则:不匹配→强制走反代;匹配但用户主动开关→也走反代。
    const shouldRelay =
      profile.source === 'manual' &&
      upstreamProtocol !== undefined &&
      upstreamProtocol !== 'openai-responses' &&
      (mismatch || routeViaProxy)
    if (!shouldRelay) return base

    // relay 分支：要求 localProxy + relayProvisioning 都已注入
    if (this.localProxy === undefined || this.relayProvisioning === undefined) {
      throw new Error('需走反代中转，但本机反代接入未配置')
    }
    // 联动自动开启 API 服务：反代已运行→取当前端口；未运行→启动后取端口。
    let port: number
    try {
      port = await this.localProxy.ensureStarted()
    } catch (e) {
      const reason = e instanceof Error ? e.message : String(e)
      throw new Error(`无法自动开启 API 服务以支持路由：${reason}`)
    }

    // upstreamProtocol 已在 shouldRelay 中校验非 undefined，此处断言以满足 ensureRelayUpstream 入参类型。
    const relayProtocol = upstreamProtocol as WireProtocol
    // 建/更新 relay 上游（注册 supportsModel(profile.model)，供反代按模型名路由）。
    await this.relayProvisioning.ensureRelayUpstream({
      profileId: profile.id,
      displayName: profile.name,
      protocol: relayProtocol,
      baseUrl: profile.baseUrl,
      apiKey: input.apiKey, // 第三方明文 key（由 resolve 解出）
      models: profile.model !== undefined ? [profile.model] : [],
    })

    // 中转改用「固定注入 key」（隐藏、不进 client key 列表、仅本地）→ 反代识别后直连真实上游(本 relay)、
    // 不走路由组合；无需签发/吊销 per-档 key。
    const relayKey = this.localProxy.getRelayInjectionKey()

    // 改写 ApplyInput：baseUrl 指向反代裸 /v1（平台前缀路由已移除，反代按模型名 profile.model 分流到本 relay
    // 上游），apiKey 换成固定注入 key。注：若第三方模型名与账号池/其它 relay 撞名，按注册顺序首个命中。
    const relayInput: ApplyInput = {
      ...input,
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: relayKey,
    }
    return { profile, writer, input: relayInput }
  }
}
