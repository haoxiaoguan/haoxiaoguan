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
  ClientConfigStore,
  CreateProfileInput,
  UpdateProfileInput,
} from '../../../src/main/contexts/clientConfig/application/client-config-store'
import type { LocalProxyPort } from '../../../src/main/contexts/clientConfig/application/local-proxy-port'

// 内存假 store（解耦 MikroORM，专测 service 编排）。
class FakeStore implements ClientConfigStore {
  profiles: ClientConfigProfile[] = []
  keys = new Map<string, string>()
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
      sortIndex: this.profiles.length,
      createdAt: 0,
      updatedAt: 0,
    }
    this.profiles.push(p)
    if (input.apiKey !== undefined) this.keys.set(id, input.apiKey)
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
  }
  async setCurrent(clientId: ClientId, id: string) {
    for (const p of this.profiles) if (p.clientId === clientId) p.isCurrent = p.id === id
  }
  async resolveApiKey(id: string) {
    return this.keys.get(id) ?? ''
  }
}

let root: string
let settings: string
let store: FakeStore
let svc: ClientConfigService
let seq: number
let proxyPort: number | null

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hxg-svc-'))
  settings = join(root, 'claude', 'settings.json')
  seq = 0
  store = new FakeStore()
  const registry = new WriterRegistry()
  registry.register(new ClaudeWriter(settings))
  const snapshots = new ConfigSnapshotStore({
    baseDir: join(root, 'history'),
    clock: () => ++seq,
    genId: () => `s${seq}`,
  })
  proxyPort = 8788
  const localProxy: LocalProxyPort = {
    getPort: () => proxyPort,
    signKey: async (name) => ({ id: `key-${name}`, plaintext: 'sk-proxy-xyz' }),
    revokeKey: async () => {},
    listModels: () => ['kiro', 'claude-sonnet-4.5'],
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
})
