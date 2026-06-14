import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import TOML from '@iarna/toml'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientConfigService } from '../../../src/main/contexts/clientConfig/application/client-config-service'
import { WriterRegistry } from '../../../src/main/contexts/clientConfig/application/writer-registry'
import { ClientConfigApplier } from '../../../src/main/contexts/clientConfig/application/client-config-applier'
import { ConfigSnapshotStore } from '../../../src/main/contexts/clientConfig/infrastructure/config-snapshot'
import { ClaudeWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/claude-writer'
import { CodexWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/codex-writer'
import { codexProviderId } from '../../../src/main/contexts/clientConfig/infrastructure/codex-toml'
import type { ClientId, ClientConfigProfile } from '../../../src/main/contexts/clientConfig/domain/client-profile'
import type {
  ClientConfigWriter,
  ApplyInput,
  FileBundle,
} from '../../../src/main/contexts/clientConfig/domain/client-writer'
import type {
  ClientConfigStore,
  CreateProfileInput,
  UpdateProfileInput,
} from '../../../src/main/contexts/clientConfig/application/client-config-store'
import type { LocalProxyPort } from '../../../src/main/contexts/clientConfig/application/local-proxy-port'
import type { RelayProvisioningPort } from '../../../src/main/contexts/clientConfig/application/relay-provisioning-port'

// 内存假 store（解耦 MikroORM，专测 service 编排）。
class FakeStore implements ClientConfigStore {
  profiles: ClientConfigProfile[] = []
  keys = new Map<string, string>()
  keyRefs = new Map<string, string>()
  private n = 0
  async list(clientId?: ClientId) {
    return this.profiles
      .filter((p) => clientId === undefined || p.clientId === clientId)
      .sort((a, b) => a.sortIndex - b.sortIndex)
  }
  async get(id: string) {
    return this.profiles.find((p) => p.id === id) ?? null
  }
  async create(input: CreateProfileInput) {
    const id = `pf${++this.n}`
    const p: ClientConfigProfile = {
      id,
      clientId: input.clientId,
      name: input.name,
      source: input.source,
      baseUrl: input.baseUrl,
      ...(input.model !== undefined ? { model: input.model } : {}),
      ...(input.settings !== undefined ? { settings: input.settings } : {}),
      isCurrent: false,
      enabled: false,
      isDefault: false,
      sortIndex: this.profiles.length,
      createdAt: 0,
      updatedAt: 0,
    }
    this.profiles.push(p)
    if (input.apiKey !== undefined) this.keys.set(id, input.apiKey)
    if (input.keyRef !== undefined) this.keyRefs.set(id, input.keyRef)
    return p
  }
  async update(id: string, patch: UpdateProfileInput) {
    const p = this.profiles.find((x) => x.id === id)
    if (!p) return
    if (patch.name !== undefined) p.name = patch.name
    if (patch.baseUrl !== undefined) p.baseUrl = patch.baseUrl
    if (patch.apiKey !== undefined) this.keys.set(id, patch.apiKey)
    if (patch.keyRef !== undefined) {
      if (patch.keyRef === null) this.keyRefs.delete(id)
      else this.keyRefs.set(id, patch.keyRef)
    }
  }
  async delete(id: string) {
    this.profiles = this.profiles.filter((p) => p.id !== id)
    this.keys.delete(id)
    this.keyRefs.delete(id)
  }
  async setCurrent(clientId: ClientId, id: string) {
    for (const p of this.profiles) if (p.clientId === clientId) p.isCurrent = p.id === id
  }
  async setEnabled(id: string, enabled: boolean) {
    const p = this.profiles.find((x) => x.id === id)
    if (p) p.enabled = enabled
  }
  async setDefault(clientId: ClientId, id: string) {
    for (const p of this.profiles) if (p.clientId === clientId) p.isDefault = p.id === id
  }
  async resolveApiKey(id: string) {
    return this.keys.get(id) ?? ''
  }
  async getKeyRef(id: string) {
    return this.keyRefs.get(id) ?? null
  }
}

// 内存假累加式写入器（opencode 形态）：provider map 多档共存 + 顶层 default 指针。
class FakeAdditiveWriter implements ClientConfigWriter {
  readonly clientId: ClientId = 'opencode'
  readonly writeMode = 'additive' as const
  constructor(private readonly path: string) {}
  configFiles() {
    return [this.path]
  }
  private parse(current: FileBundle): { providers: Record<string, unknown>; default: string | null } {
    const raw = current[this.path]
    if (raw === null || raw === undefined) return { providers: {}, default: null }
    return JSON.parse(raw)
  }
  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    const cfg = this.parse(current)
    cfg.providers[input.profileId] = { baseUrl: input.baseUrl, model: input.model ?? null }
    if (input.isDefault === true) cfg.default = input.profileId
    return { [this.path]: JSON.stringify(cfg) }
  }
  renderClear(current: FileBundle, profileId: string): FileBundle {
    const cfg = this.parse(current)
    delete cfg.providers[profileId]
    if (cfg.default === profileId) cfg.default = null
    return { [this.path]: JSON.stringify(cfg) }
  }
}

// 内存假写入器:renderApply 总是抛(模拟目标客户端配置损坏拒写),验失败补偿。
class ThrowingWriter implements ClientConfigWriter {
  readonly clientId: ClientId = 'hermes'
  readonly writeMode = 'additive' as const
  configFiles() {
    return ['/tmp/hxg-throwing/never']
  }
  renderApply(): FileBundle {
    throw new Error('模拟配置损坏拒写')
  }
  renderClear(): FileBundle {
    return {}
  }
}

let root: string
let settings: string
let ocPath: string
let codexCfg: string
let codexCat: string
let codexAuth: string
let catalogModels: Array<{ id: string; displayName?: string; contextLength?: number }>
let codexRelayOn: boolean
let store: FakeStore
let svc: ClientConfigService
let registry: WriterRegistry
let seq: number
let proxyPort: number | null
let proxyRunning: boolean
let proxyStartCalls: number
let ensureStartedCalls: number
let proxyModels: string[]
let revokedKeys: string[]
let relayEnsureCalls: Array<Parameters<RelayProvisioningPort['ensureRelayUpstream']>[0]>
let relayRemoveCalls: string[]
let relayPlatformCounter: number

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hxg-svc-'))
  settings = join(root, 'claude', 'settings.json')
  ocPath = join(root, 'opencode', 'opencode.json')
  codexCfg = join(root, 'codex', 'config.toml')
  codexCat = join(root, 'codex-model-catalog.json')
  codexAuth = join(root, 'codex', 'auth.json')
  catalogModels = [
    { id: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5', contextLength: 200000 },
    { id: 'deepseek-chat', displayName: 'DeepSeek Chat' },
  ]
  seq = 0
  store = new FakeStore()
  registry = new WriterRegistry()
  registry.register(new ClaudeWriter(settings))
  registry.register(new FakeAdditiveWriter(ocPath))
  registry.register(new CodexWriter(codexCfg, codexCat, codexAuth))
  const snapshots = new ConfigSnapshotStore({
    baseDir: join(root, 'history'),
    clock: () => ++seq,
    genId: () => `s${seq}`,
  })
  proxyPort = 8788
  proxyRunning = true
  proxyStartCalls = 0
  ensureStartedCalls = 0
  proxyModels = ['kiro', 'claude-sonnet-4.5']
  revokedKeys = []
  relayEnsureCalls = []
  relayRemoveCalls = []
  relayPlatformCounter = 0
  const localProxy: LocalProxyPort = {
    getPort: () => (proxyRunning ? proxyPort : null),
    ensureStarted: async () => {
      ensureStartedCalls++
      // 模拟联动自动开启：未运行则「启动」反代（标记 running），再取端口。
      if (!proxyRunning) {
        proxyStartCalls++
        proxyRunning = true
      }
      if (proxyPort === null) throw new Error('API 服务已启动但未就绪（无监听端口）')
      return proxyPort
    },
    signKey: async (name) => ({ id: `key-${name}`, plaintext: `sk-${name}` }),
    revokeKey: async (id) => {
      revokedKeys.push(id)
    },
    getRelayInjectionKey: () => 'sk-hxg-relay-test',
    listModels: () => proxyModels,
    listCatalogModels: () => catalogModels,
    listAccountPoolModels: () => [{ id: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5' }],
  }
  const relayProvisioning: RelayProvisioningPort = {
    ensureRelayUpstream: async (input) => {
      relayEnsureCalls.push(input)
      relayPlatformCounter++
      return { platform: `relay-${relayPlatformCounter}` }
    },
    removeRelayUpstream: async (profileId) => {
      relayRemoveCalls.push(profileId)
    },
  }
  codexRelayOn = false
  svc = new ClientConfigService(
    store,
    registry,
    new ClientConfigApplier(snapshots),
    snapshots,
    localProxy,
    relayProvisioning,
    () => codexRelayOn,
  )
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

function newClaude(name: string, baseUrl: string, apiKey: string) {
  return svc.create({ clientId: 'claude', name, source: 'manual', baseUrl, apiKey, model: 'kiro' })
}

describe('ClientConfigService', () => {
  it('preview 不写盘；apply 写客户端配置并设为当前', async () => {
    const p = await newClaude('A', 'http://a', 'key-a')

    const diff = await svc.preview(p.id)
    expect(existsSync(settings)).toBe(false)
    expect(JSON.parse(diff[0].after!).env.ANTHROPIC_AUTH_TOKEN).toBe('key-a')

    await svc.apply(p.id)
    expect(JSON.parse(await readFile(settings, 'utf8')).env.ANTHROPIC_BASE_URL).toBe('http://a')
    expect((await svc.list('claude'))[0].isCurrent).toBe(true)
  })

  it('切换：apply 另一档 → 旧档 isCurrent 置否、新档生效、文件随之覆盖', async () => {
    const a = await newClaude('A', 'http://a', 'key-a')
    const b = await newClaude('B', 'http://b', 'key-b')
    await svc.apply(a.id)
    await svc.apply(b.id)
    const list = await svc.list('claude')
    expect(list.find((x) => x.id === a.id)!.isCurrent).toBe(false)
    expect(list.find((x) => x.id === b.id)!.isCurrent).toBe(true)
    expect(JSON.parse(await readFile(settings, 'utf8')).env.ANTHROPIC_BASE_URL).toBe('http://b')
  })

  it('clear 还原（移除我们的键）；history + rollback 可回到写前', async () => {
    const a = await newClaude('A', 'http://a', 'key-a')
    await svc.apply(a.id)
    const firstSnap = (await svc.history('claude')).slice(-1)[0] // 最早一条=写前(文件不存在)
    await svc.clear(a.id)
    expect('ANTHROPIC_BASE_URL' in JSON.parse(await readFile(settings, 'utf8')).env).toBe(false)

    await svc.rollback('claude', firstSnap.id)
    expect(existsSync(settings)).toBe(false) // 回到首次写前的「不存在」
  })

  it('未知客户端写入器 → apply 抛错', async () => {
    const p = await svc.create({ clientId: 'hermes', name: 'X', source: 'manual', baseUrl: 'http://h', apiKey: 'k' })
    await expect(svc.apply(p.id)).rejects.toThrow(/客户端写入器/)
  })

  it('connectLocalProxy：建 local-proxy 接入档并立即写入+启用', async () => {
    const p = await svc.connectLocalProxy('claude')
    expect(p.source).toBe('local-proxy')
    expect(p.baseUrl).toBe('http://127.0.0.1:8788')
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8788')
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-client-config:claude')
    expect(written.env.ANTHROPIC_MODEL).toBe('kiro') // listModels 首个
    expect((await svc.list('claude'))[0].isCurrent).toBe(true)
  })

  // ---- Codex 供应商接入（单选 + 中转注入=原生共存开关）----

  it('OFF + 启用号小管账号：catalog 只含账号池(无原生)；requires_openai_auth 恒 true(实证 recipe)', async () => {
    codexRelayOn = false
    const acct = await svc.connectLocalProxy('codex') // 建档 + 单选选中
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    const pid = codexProviderId(acct.id)
    expect(cfg.model_provider).toBe(pid)
    expect(cfg.model_providers[pid].base_url).toBe('http://127.0.0.1:8788/v1')
    expect(cfg.model_providers[pid].requires_openai_auth).toBe(true) // 恒 true：登录显示由 auth.json 驱动
    expect(cfg.model_providers[pid].supports_websockets).toBe(false)
    expect(cfg.model_catalog_json).toBe(codexCat)
    const slugs = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string }> }).models.map((m) => m.slug)
    expect(slugs).toContain('claude-sonnet-4.5') // 账号池
    expect(slugs.some((s) => s.startsWith('gpt-5'))).toBe(false) // OFF 不含原生
  })

  it('OFF + 启用 responses 协议第三方：直连其端点，catalog 只含其模型', async () => {
    codexRelayOn = false
    const tp = await svc.create({ clientId: 'codex', name: 'DeepSeek', source: 'manual', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds', model: 'deepseek-chat', settings: { upstreamProtocol: 'openai-responses' } })
    await svc.enable(tp.id)
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    const pid = codexProviderId(tp.id)
    expect(cfg.model_provider).toBe(pid)
    expect(cfg.model_providers[pid].base_url).toBe('https://api.deepseek.com/v1') // 直连
    expect(cfg.model_providers[pid].requires_openai_auth).toBe(true) // 恒 true
    const slugs = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string }> }).models.map((m) => m.slug)
    expect(slugs).toContain('deepseek-chat')
    expect(slugs.some((s) => s.startsWith('gpt-5'))).toBe(false)
  })

  it('OFF + 非 responses 上游(或老档无 upstreamProtocol) → 启用报错提示开中转注入，不写盘', async () => {
    codexRelayOn = false
    const tp = await svc.create({ clientId: 'codex', name: 'DeepSeek', source: 'manual', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'sk-ds', model: 'deepseek-chat', settings: { upstreamProtocol: 'openai-chat' } })
    await expect(svc.enable(tp.id)).rejects.toThrow(/中转注入/)
    const legacy = await svc.create({ clientId: 'codex', name: '老档', source: 'manual', baseUrl: 'https://api.old.com/v1', apiKey: 'k', model: 'm' })
    await expect(svc.enable(legacy.id)).rejects.toThrow(/中转注入/) // 无 upstreamProtocol 默认按 chat 对待
  })

  it('ON + responses 协议第三方：经反代（C3），catalog 并原生共存', async () => {
    codexRelayOn = true
    const tp = await svc.create({ clientId: 'codex', name: 'Resp', source: 'manual', baseUrl: 'https://api.resp.com/v1', apiKey: 'k', model: 'resp-1', settings: { upstreamProtocol: 'openai-responses' } })
    await svc.enable(tp.id)
    // C3：ON + responses → 收编进反代，base_url 指向 8788/v1
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    expect(cfg.model_providers[codexProviderId(tp.id)].base_url).toBe('http://127.0.0.1:8788/v1')
    expect(cfg.model_providers[codexProviderId(tp.id)].requires_openai_auth).toBe(true)
    // ensureRelayUpstream 被调用，protocol='openai-responses'
    expect(relayEnsureCalls.some((c) => c.profileId === tp.id && c.protocol === 'openai-responses')).toBe(true)
    // catalog 并原生（viaProxy=true + relayOn=true）；resp-1 不与原生 slug 撞名，无 -hxg 后缀
    const slugs = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string }> }).models.map((m) => m.slug)
    expect(slugs).toContain('resp-1') // 第三方 slug（无别名，不撞名）
  })

  it('ON + responses 协议第三方（C3）：ensureRelayUpstream 收到 protocol=openai-responses + RelayModelAlias', async () => {
    codexRelayOn = true
    const tp = await svc.create({ clientId: 'codex', name: 'MyResp', source: 'manual', baseUrl: 'https://api.myresp.com/v1', apiKey: 'sk-r', model: 'resp-model-x', settings: { upstreamProtocol: 'openai-responses' } })
    await svc.enable(tp.id)
    // 必须调 ensureRelayUpstream 且 protocol 为 openai-responses
    const call = relayEnsureCalls.find((c) => c.profileId === tp.id)
    expect(call).toBeDefined()
    expect(call!.protocol).toBe('openai-responses')
    expect(call!.baseUrl).toBe('https://api.myresp.com/v1')
    // models 是 RelayModelAlias 数组（alias/real）；resp-model-x 不撞原生名，alias===real
    const mArr = call!.models as Array<{ alias: string; real: string }>
    expect(mArr).toHaveLength(1)
    expect(mArr[0].alias).toBe('resp-model-x')
    expect(mArr[0].real).toBe('resp-model-x')
  })

  it('ON + responses 协议第三方（C3）：catalog 并原生，slug=alias（不撞名时无 -hxg 后缀）', async () => {
    codexRelayOn = true
    const tp = await svc.create({ clientId: 'codex', name: 'MyResp', source: 'manual', baseUrl: 'https://api.myresp.com/v1', apiKey: 'sk-r', model: 'resp-model-x', settings: { upstreamProtocol: 'openai-responses' } })
    await svc.enable(tp.id)
    // viaProxy=true + relayOn=true → codexCatalogIncludeNative=true → catalog 并原生（来自 models_cache）
    // 测试环境无 models_cache，故原生条目为 0，只验第三方 slug 存在、无 -hxg 后缀
    const slugs = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string }> }).models.map((m) => m.slug)
    expect(slugs).toContain('resp-model-x')
    expect(slugs).not.toContain('resp-model-x-hxg') // 不撞名，无需别名后缀
  })

  it('OFF + responses 协议第三方（C3 关闭）：直连，不调 ensureRelayUpstream，catalog 不并原生', async () => {
    codexRelayOn = false
    const tp = await svc.create({ clientId: 'codex', name: 'OffResp', source: 'manual', baseUrl: 'https://api.offresp.com/v1', apiKey: 'sk-off', model: 'off-model', settings: { upstreamProtocol: 'openai-responses' } })
    await svc.enable(tp.id)
    // OFF → 直连，base_url 是第三方原始 URL
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    expect(cfg.model_providers[codexProviderId(tp.id)].base_url).toBe('https://api.offresp.com/v1')
    // 不调 ensureRelayUpstream
    expect(relayEnsureCalls.some((c) => c.profileId === tp.id)).toBe(false)
    // catalog 不并原生（viaProxy=false）
    const slugs = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string }> }).models.map((m) => m.slug)
    expect(slugs).toContain('off-model')
  })

  it('单选：启用 B 自动停用 A', async () => {
    codexRelayOn = false
    const a = await svc.connectLocalProxy('codex')
    const b = await svc.create({ clientId: 'codex', name: 'DeepSeek', source: 'manual', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', settings: { upstreamProtocol: 'openai-responses' } })
    await svc.enable(b.id)
    const list = await svc.list('codex')
    expect(list.find((p) => p.id === a.id)!.enabled).toBe(false) // A 被自动停用
    expect(list.find((p) => p.id === b.id)!.enabled).toBe(true)
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    expect(cfg.model_provider).toBe(codexProviderId(b.id)) // 顶层指向 B
  })

  it('ON + 启用号小管账号：requires_openai_auth=true，catalog 含原生+账号池(真共存)', async () => {
    codexRelayOn = true
    const acct = await svc.connectLocalProxy('codex')
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    const pid = codexProviderId(acct.id)
    expect(cfg.model_providers[pid].requires_openai_auth).toBe(true) // 真共存：保留 ChatGPT 登录
    const slugs = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string }> }).models.map((m) => m.slug)
    expect(slugs.some((s) => s.startsWith('gpt-5'))).toBe(true) // 原生共存
    expect(slugs).toContain('claude-sonnet-4.5') // 账号池
  })

  it('ON + 启用可中转第三方：供 relay + 经反代路由(base_url=8788) + bearer=固定注入 key', async () => {
    codexRelayOn = true
    const tp = await svc.create({ clientId: 'codex', name: 'DeepSeek', source: 'manual', baseUrl: 'https://api.deepseek.com/v1', apiKey: 'k', model: 'deepseek-chat', settings: { upstreamProtocol: 'openai-chat' } })
    await svc.enable(tp.id)
    expect(relayEnsureCalls.some((c) => c.profileId === tp.id)).toBe(true) // 已供 relay
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    const pid = codexProviderId(tp.id)
    expect(cfg.model_providers[pid].base_url).toBe('http://127.0.0.1:8788/v1') // 经反代
    expect(cfg.model_providers[pid].requires_openai_auth).toBe(true)
    // 中转注入用固定隐藏 key（反代识别后直连真实上游、不走组合）；不再 per-档 签发，keyRef 空。
    expect(cfg.model_providers[pid].experimental_bearer_token).toBe('sk-hxg-relay-test')
    expect(await store.getKeyRef(tp.id)).toBeNull()
  })

  it('ON 中转用固定注入 key：bearer=固定 key、不签发/不吊销 per-档 key、keyRef 空；local-proxy 档主 key 不受牵连', async () => {
    codexRelayOn = true
    const tp = await svc.create({ clientId: 'codex', name: 'R', source: 'manual', baseUrl: 'https://r/v1', apiKey: 'k', model: 'm-x', settings: { upstreamProtocol: 'openai-responses' } })
    await svc.enable(tp.id)
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    expect(cfg.model_providers[codexProviderId(tp.id)].experimental_bearer_token).toBe('sk-hxg-relay-test')
    expect(await store.getKeyRef(tp.id)).toBeNull() // 固定 key，不 per-档 签发/跟踪
    await svc.enable(tp.id) // 再启用：仍同一固定 key，不签新不吊旧
    await svc.disable(tp.id)
    expect(revokedKeys).toHaveLength(0) // 固定 key 不吊销
    // local-proxy 档：用自己签发的主 key，disable 不吊销(再启用还要用)。
    revokedKeys.length = 0
    codexRelayOn = false
    const acct = await svc.connectLocalProxy('codex')
    await svc.disable(acct.id)
    expect(revokedKeys).toHaveLength(0)
    expect(await store.getKeyRef(acct.id)).not.toBeNull()
  })

  it('停用：清除该供应商注入', async () => {
    codexRelayOn = false
    const acct = await svc.connectLocalProxy('codex')
    await svc.disable(acct.id)
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    expect(cfg.model_providers?.[codexProviderId(acct.id)]).toBeUndefined()
    expect((await svc.list('codex')).find((p) => p.id === acct.id)!.enabled).toBe(false)
  })

  it('反代无法启动(port null) → connectLocalProxy 抛错', async () => {
    // connectLocalProxy 已改为自动启动语义：ensureStarted 起不来（无监听端口）即包装抛错。
    proxyPort = null
    await expect(svc.connectLocalProxy('claude')).rejects.toThrow(/无法自动开启 API 服务/)
  })

  // ---- 累加式共存 ----
  function newOpencode(name: string, baseUrl: string, model: string) {
    return svc.create({ clientId: 'opencode', name, source: 'manual', baseUrl, apiKey: 'k', model })
  }

  it('累加式 enable 两份 → live 同时含两者，首份为默认', async () => {
    const a = await newOpencode('A', 'http://a', 'm-a')
    const b = await newOpencode('B', 'http://b', 'm-b')
    await svc.enable(a.id)
    await svc.enable(b.id)
    const cfg = JSON.parse(await readFile(ocPath, 'utf8'))
    expect(Object.keys(cfg.providers).sort()).toEqual([a.id, b.id].sort())
    expect(cfg.default).toBe(a.id) // 首个 enable 顺带设默认
    const list = await svc.list('opencode')
    expect(list.find((x) => x.id === a.id)!.enabled).toBe(true)
    expect(list.find((x) => x.id === b.id)!.enabled).toBe(true)
    expect(list.find((x) => x.id === a.id)!.isDefault).toBe(true)
  })

  it('累加式 disable 一份 → 仅移除该份，另一份保留', async () => {
    const a = await newOpencode('A', 'http://a', 'm-a')
    const b = await newOpencode('B', 'http://b', 'm-b')
    await svc.enable(a.id)
    await svc.enable(b.id)
    await svc.disable(a.id)
    const cfg = JSON.parse(await readFile(ocPath, 'utf8'))
    expect(Object.keys(cfg.providers)).toEqual([b.id])
    expect((await svc.list('opencode')).find((x) => x.id === a.id)!.enabled).toBe(false)
  })

  it('累加式 setDefault → 改写默认指针，同 client 其余取消默认', async () => {
    const a = await newOpencode('A', 'http://a', 'm-a')
    const b = await newOpencode('B', 'http://b', 'm-b')
    await svc.enable(a.id)
    await svc.enable(b.id)
    await svc.setDefault('opencode', b.id)
    const cfg = JSON.parse(await readFile(ocPath, 'utf8'))
    expect(cfg.default).toBe(b.id)
    const list = await svc.list('opencode')
    expect(list.find((x) => x.id === b.id)!.isDefault).toBe(true)
    expect(list.find((x) => x.id === a.id)!.isDefault).toBe(false)
  })

  it('switch 客户端 setDefault → 抛错（仅累加式支持）', async () => {
    const p = await newClaude('A', 'http://a', 'key-a')
    await expect(svc.setDefault('claude', p.id)).rejects.toThrow(/累加式/)
  })

  // ---- review 修复回归 ----
  it('setDefault 到无模型档 → 抛错(无法设默认,防 store↔live 分叉)', async () => {
    const p = await svc.create({ clientId: 'opencode', name: 'X', source: 'manual', baseUrl: 'http://x', apiKey: 'k' })
    await expect(svc.setDefault('opencode', p.id)).rejects.toThrow(/未指定模型/)
  })

  it('enable 无模型档(首个) → 注入并 enabled 但不设默认', async () => {
    const p = await svc.create({ clientId: 'opencode', name: 'X', source: 'manual', baseUrl: 'http://x', apiKey: 'k' })
    await svc.enable(p.id)
    const list = await svc.list('opencode')
    expect(list[0].enabled).toBe(true)
    expect(list[0].isDefault).toBe(false) // 无模型不充当默认,store 与 live 不分叉
  })

  it('删 local-proxy 接入档 → 联动吊销 keyRef 反代 key', async () => {
    const p = await svc.connectLocalProxy('claude')
    await svc.delete(p.id)
    expect(revokedKeys).toContain('key-client-config:claude')
  })

  it('connectLocalProxy 注入失败 → 吊销 key 且不留半截 profile', async () => {
    registry.register(new ThrowingWriter()) // hermes 写入器 renderApply 抛错
    await expect(svc.connectLocalProxy('hermes')).rejects.toThrow(/损坏/)
    expect(revokedKeys).toContain('key-client-config:hermes')
    expect((await svc.list('hermes')).length).toBe(0) // 半截 profile 已回滚
  })

  // ---- relay 分流（T9）----

  it('relay-direct：claude 档 upstreamProtocol=anthropic（与 claude 原生协议匹配）→ apply 用原始 baseUrl/key，未调 ensureRelayUpstream', async () => {
    const p = await svc.create({
      clientId: 'claude',
      name: 'third-party-direct',
      source: 'manual',
      baseUrl: 'http://third-party',
      apiKey: 'tp-key',
      model: 'gpt-4o',
      settings: { upstreamProtocol: 'anthropic' },
    })
    await svc.apply(p.id)
    // 未调 ensureRelayUpstream
    expect(relayEnsureCalls.length).toBe(0)
    // 写盘的 baseUrl/key 是原始第三方值
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://third-party')
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('tp-key')
  })

  it('relay-relay：claude 档 upstreamProtocol=openai-chat（不匹配）→ apply 调 ensureRelayUpstream，写盘指向反代', async () => {
    const p = await svc.create({
      clientId: 'claude',
      name: 'third-party-relay',
      source: 'manual',
      baseUrl: 'http://openai-compat',
      apiKey: 'oai-key',
      model: 'gpt-4o',
      settings: { upstreamProtocol: 'openai-chat' },
    })
    await svc.apply(p.id)
    // 不匹配 → 联动调用 ensureStarted + ensureRelayUpstream
    expect(ensureStartedCalls).toBeGreaterThanOrEqual(1)
    // 调了 ensureRelayUpstream，参数含第三方 baseUrl/key
    expect(relayEnsureCalls.length).toBe(1)
    expect(relayEnsureCalls[0].baseUrl).toBe('http://openai-compat')
    expect(relayEnsureCalls[0].apiKey).toBe('oai-key')
    expect(relayEnsureCalls[0].protocol).toBe('openai-chat')
    expect(relayEnsureCalls[0].profileId).toBe(p.id)
    // 写盘 baseUrl 指向反代裸 /v1（按模型名路由），key 是号小管 client key
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8788/v1')
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-hxg-relay-test')
  })

  it('relay-无 upstreamProtocol：普通 manual 档（无该 settings）→ direct，不调 ensureRelayUpstream（向后兼容）', async () => {
    const p = await svc.create({
      clientId: 'claude',
      name: 'legacy-manual',
      source: 'manual',
      baseUrl: 'http://legacy',
      apiKey: 'legacy-key',
    })
    await svc.apply(p.id)
    expect(relayEnsureCalls.length).toBe(0)
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://legacy')
  })

  it('relay-反代未运行 + relay 决策 → 联动 ensureStarted 自动开启后成功写盘（不抛「反代未运行」）', async () => {
    proxyRunning = false // 反代起初未运行
    const p = await svc.create({
      clientId: 'claude',
      name: 'relay-autostart',
      source: 'manual',
      baseUrl: 'http://openai-compat',
      apiKey: 'oai-key',
      settings: { upstreamProtocol: 'openai-chat' },
    })
    await svc.apply(p.id) // 不应抛错
    // 联动自动开启：ensureStarted 被调用且触发了一次「启动」。
    expect(ensureStartedCalls).toBeGreaterThanOrEqual(1)
    expect(proxyStartCalls).toBe(1)
    expect(relayEnsureCalls.length).toBe(1)
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8788/v1')
  })

  it('relay-ensureStarted 失败（启动后仍无端口）→ apply 抛「无法自动开启 API 服务」', async () => {
    proxyRunning = false
    proxyPort = null // 启动后也取不到端口
    const p = await svc.create({
      clientId: 'claude',
      name: 'relay-no-port',
      source: 'manual',
      baseUrl: 'http://openai-compat',
      apiKey: 'oai-key',
      settings: { upstreamProtocol: 'openai-chat' },
    })
    await expect(svc.apply(p.id)).rejects.toThrow(/无法自动开启 API 服务/)
  })

  it('relay-页面路由开关：claude 档 upstreamProtocol=anthropic（协议匹配）+ 路由开关 ON → 仍走 relay', async () => {
    codexRelayOn = true // 页面级「路由」开关 ON（注入的 routingOn 对该客户端返回 true）
    const p = await svc.create({
      clientId: 'claude',
      name: 'routing-on',
      source: 'manual',
      baseUrl: 'http://anthropic-compat',
      apiKey: 'ant-key',
      model: 'claude-3',
      settings: { upstreamProtocol: 'anthropic' },
    })
    await svc.apply(p.id)
    // 协议匹配但页面「路由」开关 ON → 走反代
    expect(ensureStartedCalls).toBeGreaterThanOrEqual(1)
    expect(relayEnsureCalls.length).toBe(1)
    expect(relayEnsureCalls[0].protocol).toBe('anthropic')
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8788/v1')
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-hxg-relay-test')
  })

  it('relay-direct：协议匹配且路由开关 OFF → direct，不调 ensureStarted/ensureRelayUpstream', async () => {
    const p = await svc.create({
      clientId: 'claude',
      name: 'matched-no-toggle',
      source: 'manual',
      baseUrl: 'http://anthropic-compat',
      apiKey: 'ant-key',
      settings: { upstreamProtocol: 'anthropic' },
    })
    await svc.apply(p.id)
    expect(ensureStartedCalls).toBe(0)
    expect(relayEnsureCalls.length).toBe(0)
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://anthropic-compat')
  })

  it('relay-路由开关 ON 但无 upstreamProtocol → 仍 direct（无协议无从中转）', async () => {
    codexRelayOn = true // 页面级「路由」开关 ON，但该档无 upstreamProtocol → 无从判定中转，直连
    const p = await svc.create({
      clientId: 'claude',
      name: 'toggle-without-protocol',
      source: 'manual',
      baseUrl: 'http://legacy2',
      apiKey: 'legacy2-key',
    })
    await svc.apply(p.id)
    expect(ensureStartedCalls).toBe(0)
    expect(relayEnsureCalls.length).toBe(0)
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://legacy2')
  })

  it('relay-delete：删 manual 档 → 调 removeRelayUpstream(id)', async () => {
    const p = await svc.create({
      clientId: 'claude',
      name: 'to-delete',
      source: 'manual',
      baseUrl: 'http://x',
      apiKey: 'k',
    })
    await svc.delete(p.id)
    expect(relayRemoveCalls).toContain(p.id)
  })

  // ---- Codex 多模型列表（codexModels）----

  it('codexModels OFF+responses：多模型列表 → catalog 多条目，默认=首项 id', async () => {
    codexRelayOn = false
    const tp = await svc.create({
      clientId: 'codex',
      name: 'MultiModel',
      source: 'manual',
      baseUrl: 'https://api.example.com/v1',
      apiKey: 'sk-x',
      model: 'first-model',
      settings: {
        upstreamProtocol: 'openai-responses',
        codexModels: [
          { id: 'first-model', name: 'First Model', contextWindow: 128000 },
          { id: 'second-model', name: 'Second Model' },
        ],
      },
    })
    await svc.enable(tp.id)
    const cfg = TOML.parse(await readFile(codexCfg, 'utf8')) as any
    const pid = codexProviderId(tp.id)
    // 默认 model = 首项 id
    expect(cfg.model).toBe('first-model')
    // catalog 含两条
    const catModels = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string; display_name: string }> }).models
    const slugs = catModels.map((m) => m.slug)
    expect(slugs).toContain('first-model')
    expect(slugs).toContain('second-model')
    // displayName 原样保存（不加「号小管」后缀）
    const firstEntry = catModels.find((m) => m.slug === 'first-model')!
    expect(firstEntry.display_name).toBe('First Model')
    const secondEntry = catModels.find((m) => m.slug === 'second-model')!
    expect(secondEntry.display_name).toBe('Second Model')
    void pid
  })

  it('codexModels ON+responses：列表中撞原生名者加 -hxg 别名，不撞名者保真名', async () => {
    codexRelayOn = true
    // 模拟 getNativeSlugs 返回含 gpt-5.5 的集合
    // localProxy.listNativeModelSlugs 未在 FakeStore 中定义，需在 localProxy 添加
    // （service 测试的 FakeLocalProxy 未实现 listNativeModelSlugs → getNativeSlugs 返回 Set()）
    // 为测撞名逻辑，需要 listNativeModelSlugs 支持。此处用 monkey-patch 方式扩展 localProxy。
    const svcWithNativeSlugs = new (await import('../../../src/main/contexts/clientConfig/application/client-config-service')).ClientConfigService(
      store,
      registry,
      new (await import('../../../src/main/contexts/clientConfig/application/client-config-applier')).ClientConfigApplier(
        new (await import('../../../src/main/contexts/clientConfig/infrastructure/config-snapshot')).ConfigSnapshotStore({
          baseDir: join(root, 'history2'),
          clock: () => ++seq,
          genId: () => `s${seq}`,
        })
      ),
      new (await import('../../../src/main/contexts/clientConfig/infrastructure/config-snapshot')).ConfigSnapshotStore({
        baseDir: join(root, 'history2'),
        clock: () => ++seq,
        genId: () => `s${seq}`,
      }),
      {
        getPort: () => 8788,
        ensureStarted: async () => { ensureStartedCalls++; return 8788 },
        signKey: async (name) => ({ id: `key-${name}`, plaintext: `sk-${name}` }),
        revokeKey: async (id) => { revokedKeys.push(id) },
        getRelayInjectionKey: () => 'sk-hxg-relay-test',
        listModels: () => proxyModels,
        listCatalogModels: () => catalogModels,
        listAccountPoolModels: () => [{ id: 'claude-sonnet-4.5', displayName: 'Claude Sonnet 4.5' }],
        listNativeModelSlugs: () => ['gpt-5.5', 'gpt-5.4'],
      },
      {
        ensureRelayUpstream: async (input) => { relayEnsureCalls.push(input); relayPlatformCounter++; return { platform: `relay-${relayPlatformCounter}` } },
        removeRelayUpstream: async (profileId) => { relayRemoveCalls.push(profileId) },
      },
      () => true, // codexRelayOn = true
    )
    const tp = await store.create({
      clientId: 'codex',
      name: 'AliasTest',
      source: 'manual',
      baseUrl: 'https://api.alias.com/v1',
      apiKey: 'sk-a',
      model: 'gpt-5.5',
      settings: {
        upstreamProtocol: 'openai-responses',
        codexModels: [
          { id: 'gpt-5.5', name: 'GPT 5.5 via HXG' },   // 撞原生名 → alias = gpt-5.5-hxg
          { id: 'my-model', name: 'My Model' },           // 不撞名 → alias = my-model
        ],
      },
    })
    store.keys.set(tp.id, 'sk-a')
    await svcWithNativeSlugs.enable(tp.id)
    // ensureRelayUpstream 收到 RelayModelAlias 数组
    const call = relayEnsureCalls.find((c) => c.profileId === tp.id)
    expect(call).toBeDefined()
    const mArr = call!.models as Array<{ alias: string; real: string }>
    expect(mArr).toHaveLength(2)
    // 撞名者
    expect(mArr.find((m) => m.real === 'gpt-5.5')?.alias).toBe('gpt-5.5-hxg')
    // 不撞名者
    expect(mArr.find((m) => m.real === 'my-model')?.alias).toBe('my-model')
    // catalog slug 用 alias
    const slugs = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string; display_name: string }> }).models.map((m) => m.slug)
    expect(slugs).toContain('gpt-5.5-hxg')
    expect(slugs).toContain('my-model')
    // 原生那条（来自 fallbackTemplate/models_cache）gpt-5.5 可能存在，但第三方已别名化为 gpt-5.5-hxg，不再有第二条 gpt-5.5
    expect(slugs.filter((s) => s === 'gpt-5.5').length).toBeLessThanOrEqual(1)
    // display_name 原样保存
    const catModels = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string; display_name: string }> }).models
    expect(catModels.find((m) => m.slug === 'gpt-5.5-hxg')?.display_name).toBe('GPT 5.5 via HXG')
    expect(catModels.find((m) => m.slug === 'my-model')?.display_name).toBe('My Model')
  })

  it('codexModels 回退：settings.codexModels 缺失时用 profile.model 作单条', async () => {
    codexRelayOn = false
    const tp = await svc.create({
      clientId: 'codex',
      name: 'FallbackModel',
      source: 'manual',
      baseUrl: 'https://api.fb.com/v1',
      apiKey: 'sk-fb',
      model: 'fallback-model',
      settings: { upstreamProtocol: 'openai-responses' },
      // 无 codexModels
    })
    await svc.enable(tp.id)
    const catModels = (JSON.parse(await readFile(codexCat, 'utf8')) as { models: Array<{ slug: string }> }).models
    expect(catModels.map((m) => m.slug)).toContain('fallback-model')
  })

  it('previewDraft (codex)：catalog 预览的 display_name = 用户填的菜单显示名（不退回磁盘旧文件/原生名）', async () => {
    const diff = await svc.previewDraft({
      clientId: 'codex',
      name: '本地 5.5 反代',
      baseUrl: 'http://127.0.0.1:8080/v1',
      apiKey: 'sk-x',
      model: 'gpt-5.5',
      settings: {
        upstreamProtocol: 'openai-responses',
        codexModels: [{ id: 'gpt-5.5', name: 'gpt-5.5中转', contextWindow: 200000 }],
      },
    })
    const catFile = diff.find((d) => d.file === codexCat)
    expect(catFile?.after).toBeTruthy()
    const after = JSON.parse(catFile!.after!) as { models: Array<{ slug: string; display_name: string; context_window: number }> }
    const entry = after.models.find((m) => m.slug === 'gpt-5.5')
    expect(entry).toBeDefined()
    expect(entry!.display_name).toBe('gpt-5.5中转') // 用户填的，不是原生 GPT-5.5
    expect(entry!.context_window).toBe(200000)
  })
})
