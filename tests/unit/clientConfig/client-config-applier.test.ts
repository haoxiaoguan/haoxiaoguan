import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClientConfigApplier } from '../../../src/main/contexts/clientConfig/application/client-config-applier'
import { ConfigSnapshotStore } from '../../../src/main/contexts/clientConfig/infrastructure/config-snapshot'
import { ClaudeWriter } from '../../../src/main/contexts/clientConfig/infrastructure/writers/claude-writer'
import { ClientConfigCorruptError, type ApplyInput } from '../../../src/main/contexts/clientConfig/domain/client-writer'

let root: string
let settings: string
let store: ConfigSnapshotStore
let applier: ClientConfigApplier
let writer: ClaudeWriter
let seq: number

const input: ApplyInput = {
  profileId: 'p1', source: 'local-proxy', baseUrl: 'http://127.0.0.1:8788', apiKey: 'sk-hxg', model: 'kiro',
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
