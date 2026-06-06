import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientConfigService } from '../../../src/main/contexts/clientConfig/application/client-config-service'
import { WriterRegistry } from '../../../src/main/contexts/clientConfig/application/writer-registry'
import { ClientConfigApplier } from '../../../src/main/contexts/clientConfig/application/client-config-applier'
import { ConfigSnapshotStore } from '../../../src/main/contexts/clientConfig/infrastructure/config-snapshot'
import { ClaudeWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/claude-writer'
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
let store: FakeStore
let svc: ClientConfigService
let registry: WriterRegistry
let seq: number
let proxyPort: number | null
let proxyModels: string[]
let revokedKeys: string[]

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hxg-svc-'))
  settings = join(root, 'claude', 'settings.json')
  ocPath = join(root, 'opencode', 'opencode.json')
  seq = 0
  store = new FakeStore()
  registry = new WriterRegistry()
  registry.register(new ClaudeWriter(settings))
  registry.register(new FakeAdditiveWriter(ocPath))
  const snapshots = new ConfigSnapshotStore({
    baseDir: join(root, 'history'),
    clock: () => ++seq,
    genId: () => `s${seq}`,
  })
  proxyPort = 8788
  proxyModels = ['kiro', 'claude-sonnet-4.5']
  revokedKeys = []
  const localProxy: LocalProxyPort = {
    getPort: () => proxyPort,
    signKey: async (name) => ({ id: `key-${name}`, plaintext: 'sk-proxy-xyz' }),
    revokeKey: async (id) => {
      revokedKeys.push(id)
    },
    listModels: () => proxyModels,
  }
  svc = new ClientConfigService(store, registry, new ClientConfigApplier(snapshots), snapshots, localProxy)
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
    expect(written.env.ANTHROPIC_AUTH_TOKEN).toBe('sk-proxy-xyz')
    expect(written.env.ANTHROPIC_MODEL).toBe('kiro') // listModels 首个
    expect((await svc.list('claude'))[0].isCurrent).toBe(true)
  })

  it('反代未运行(port null) → connectLocalProxy 抛错', async () => {
    proxyPort = null
    await expect(svc.connectLocalProxy('claude')).rejects.toThrow(/反代未运行/)
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
})
