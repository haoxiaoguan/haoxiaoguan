import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientConfigApplier } from '../../../src/main/contexts/clientConfig/application/client-config-applier'
import { ConfigSnapshotStore } from '../../../src/main/contexts/clientConfig/infrastructure/config-snapshot'
import { ClaudeWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/claude-writer'
import { ClientConfigCorruptError, type ApplyInput, type ClientConfigWriter, type FileBundle, type WriteLifecycle, type WriteLifecycleToken } from '../../../src/main/contexts/clientConfig/domain/client-writer'

let root: string
let settings: string
let store: ConfigSnapshotStore
let applier: ClientConfigApplier
let writer: ClaudeWriter
let seq: number

const input: ApplyInput = {
  profileId: 'p1', name: '本机反代', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'sk-hxg', model: 'kiro',
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hxg-applier-'))
  await mkdir(join(root, 'client'), { recursive: true })
  settings = join(root, 'client', 'settings.json')
  seq = 0
  store = new ConfigSnapshotStore({ baseDir: join(root, 'history'), clock: () => ++seq, genId: () => `id${seq}` })
  applier = new ClientConfigApplier(store)
  writer = new ClaudeWriter(settings)
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ClientConfigApplier', () => {
  it('apply：写入文件 + 拍一条写前快照', async () => {
    await applier.apply(writer, input)
    const written = JSON.parse(await readFile(settings, 'utf8'))
    expect(written.env.ANTHROPIC_BASE_URL).toBe('http://127.0.0.1:8788')
    const snaps = await store.list('claude')
    expect(snaps).toHaveLength(1)
    expect(snaps[0].action).toBe('apply')
    expect(snaps[0].files[settings]).toBeNull() // 写前文件不存在
  })

  it('preview：纯计算 before/after，不写盘不快照', async () => {
    const diff = await applier.preview(writer, input)
    expect(existsSync(settings)).toBe(false)
    expect(await store.list('claude')).toHaveLength(0)
    expect(diff).toHaveLength(1)
    expect(diff[0].before).toBeNull()
    expect(JSON.parse(diff[0].after!).env.ANTHROPIC_AUTH_TOKEN).toBe('sk-hxg')
  })

  it('apply 后可经快照回滚到写前（文件被删回不存在）', async () => {
    await applier.apply(writer, input)
    expect(existsSync(settings)).toBe(true)
    const id = (await store.list('claude'))[0].id
    await store.restore('claude', id)
    expect(existsSync(settings)).toBe(false) // 回到写前「不存在」
  })

  it('clear：移除我们的键 + 拍快照', async () => {
    await writeFile(join(root, 'client', 'settings.json'), JSON.stringify({ env: { FOO: 'bar' } }), 'utf8')
    await applier.apply(writer, input)
    await applier.clear(writer, 'p1')
    const after = JSON.parse(await readFile(settings, 'utf8'))
    expect('ANTHROPIC_BASE_URL' in after.env).toBe(false)
    expect(after.env.FOO).toBe('bar')
  })

  it('损坏配置：renderApply 抛错发生在快照/写盘之前（不留快照、不改文件）', async () => {
    await mkdir(join(root, 'client'), { recursive: true })
    await writeFile(settings, '{ corrupt', 'utf8')
    await expect(applier.apply(writer, input)).rejects.toThrow(ClientConfigCorruptError)
    expect(await readFile(settings, 'utf8')).toBe('{ corrupt') // 文件未被动
    expect(await store.list('claude')).toHaveLength(0) // 未拍快照
  })
})

// 仅记录调用顺序的假生命周期（Codex 桌面 App 停-写-启）。
class OrderLifecycle implements WriteLifecycle {
  readonly log: string[]
  private readonly failBefore: boolean
  constructor(log: string[], failBefore = false) {
    this.log = log
    this.failBefore = failBefore
  }
  async beforeWrite(): Promise<WriteLifecycleToken> {
    this.log.push('before')
    if (this.failBefore) throw new Error('停不掉 App')
    return { restart: true }
  }
  async afterWrite(_token: WriteLifecycleToken): Promise<void> {
    this.log.push('after')
  }
}

// 最小假写入器：写一个文件，挂可选 lifecycle。
class FakeWriter implements ClientConfigWriter {
  readonly clientId = 'codex' as const
  readonly writeMode = 'additive' as const
  readonly lifecycle?: WriteLifecycle
  private readonly file: string
  constructor(file: string, lifecycle?: WriteLifecycle) {
    this.file = file
    this.lifecycle = lifecycle
  }
  configFiles(): string[] {
    return [this.file]
  }
  renderApply(_current: FileBundle, _input: ApplyInput): FileBundle {
    return { [this.file]: 'NEW' }
  }
  renderClear(_current: FileBundle, _profileId: string): FileBundle {
    return { [this.file]: 'CLEARED' }
  }
}

describe('ClientConfigApplier 生命周期（Codex 停-写-启）', () => {
  it('apply：beforeWrite → 写盘 → afterWrite，文件写成功', async () => {
    const log: string[] = []
    const file = join(root, 'client', 'config.toml')
    const w = new FakeWriter(file, new OrderLifecycle(log))
    await applier.apply(w, input)
    expect(log).toEqual(['before', 'after']) // 钩子包住了写盘
    expect(await readFile(file, 'utf8')).toBe('NEW') // 写盘确实发生（在两钩子之间）
  })

  it('beforeWrite 抛错（停不掉 App）：中止 → 不写盘、不快照、不调 afterWrite', async () => {
    const log: string[] = []
    const file = join(root, 'client', 'config.toml')
    const w = new FakeWriter(file, new OrderLifecycle(log, true))
    await expect(applier.apply(w, input)).rejects.toThrow(/停不掉/)
    expect(log).toEqual(['before']) // afterWrite 未调用
    expect(existsSync(file)).toBe(false) // 没写盘
    expect(await store.list('codex')).toHaveLength(0) // 没快照
  })

  it('写盘失败也要重启 App：afterWrite 在 finally 里照常执行', async () => {
    const log: string[] = []
    // 把"文件"路径设成一个目录 → atomicWrite 必失败，触发写盘异常路径。
    const dirAsFile = join(root, 'client', 'is-a-dir')
    await mkdir(dirAsFile, { recursive: true })
    const w = new FakeWriter(dirAsFile, new OrderLifecycle(log))
    await expect(applier.apply(w, input)).rejects.toThrow()
    expect(log).toEqual(['before', 'after']) // 写失败，afterWrite 仍恢复了 App
  })

  it('无 lifecycle 的写入器：行为不变（不触发任何停-启）', async () => {
    const file = join(root, 'client', 'config.toml')
    const w = new FakeWriter(file) // 无 lifecycle
    await applier.apply(w, input)
    expect(await readFile(file, 'utf8')).toBe('NEW')
  })
})
