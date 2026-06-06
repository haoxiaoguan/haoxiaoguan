import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, readFile, writeFile, mkdir } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ConfigSnapshotStore } from '../../../src/main/contexts/clientConfig/infrastructure/config-snapshot'

let root: string
let history: string
let target: string // 模拟客户端配置文件
let t: number
let seq: number

function store(limit?: number) {
  return new ConfigSnapshotStore({
    baseDir: history,
    ...(limit !== undefined ? { limit } : {}),
    clock: () => ++t,
    genId: () => `id${++seq}`,
  })
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hxg-snap-'))
  history = join(root, 'history')
  target = join(root, 'client', 'settings.json')
  await mkdir(join(root, 'client'), { recursive: true })
  t = 0
  seq = 0
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('ConfigSnapshotStore', () => {
  it('capture 记录文件当前内容（不存在记 null），list 倒序返回', async () => {
    const s = store()
    await writeFile(target, 'v1', 'utf8')
    await s.capture('claude', 'apply', [target], 'p1')
    await writeFile(target, 'v2', 'utf8')
    await s.capture('claude', 'switch', [target])

    const list = await s.list('claude')
    expect(list).toHaveLength(2)
    expect(list[0].action).toBe('switch') // 最新在前
    expect(list[1].files[target]).toBe('v1')
    expect(list[1].profileId).toBe('p1')
  })

  it('capture 对不存在的文件记 null', async () => {
    const s = store()
    await s.capture('codex', 'apply', [target])
    expect((await s.list('codex'))[0].files[target]).toBeNull()
  })

  it('FIFO 裁剪到 limit', async () => {
    const s = store(2)
    for (let i = 0; i < 4; i++) {
      await writeFile(target, `v${i}`, 'utf8')
      await s.capture('claude', 'apply', [target])
    }
    const list = await s.list('claude')
    expect(list).toHaveLength(2)
    // 保留最新两条（v2、v3 之前的状态）
    expect(list[0].files[target]).toBe('v3')
    expect(list[1].files[target]).toBe('v2')
  })

  it('restore 把文件写回快照内容，且回滚本身先存一条（双向可逆）', async () => {
    const s = store()
    await writeFile(target, 'original', 'utf8')
    const id = await s.capture('claude', 'apply', [target], 'p1')
    await writeFile(target, 'changed', 'utf8')

    await s.restore('claude', id)
    expect(await readFile(target, 'utf8')).toBe('original')

    // restore 前拍了一条 rollback 快照（内容='changed'），故可再回滚回 'changed'
    const list = await s.list('claude')
    const rollbackEntry = list.find((e) => e.action === 'rollback')
    expect(rollbackEntry).toBeDefined()
    expect(rollbackEntry!.files[target]).toBe('changed')
    await s.restore('claude', rollbackEntry!.id)
    expect(await readFile(target, 'utf8')).toBe('changed')
  })

  it('restore 到「当时文件不存在」的快照 → 删除该文件', async () => {
    const s = store()
    const id = await s.capture('claude', 'apply', [target]) // 此时 target 不存在 → null
    await writeFile(target, 'created-later', 'utf8')
    expect(existsSync(target)).toBe(true)

    await s.restore('claude', id)
    expect(existsSync(target)).toBe(false)
  })

  it('list 对空/不存在目录返回 []；restore 未知 id 抛错', async () => {
    const s = store()
    expect(await s.list('hermes')).toEqual([])
    await expect(s.restore('hermes', 'nope')).rejects.toThrow()
  })
})
