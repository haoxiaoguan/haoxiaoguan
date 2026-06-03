import { createHash } from 'node:crypto'
import { describe, it, expect } from 'vitest'
import { migrateClientKeys } from '../../../src/main/contexts/apiProxy/application/migrate-client-keys'

function stubName(key: string) {
  return `migrated-${createHash('sha256').update(key).digest('hex').slice(0, 8)}`
}

function stubRepo(preExisting: string[] = []) {
  const created: string[] = []
  const store: Array<{ id: string; name: string; keyPrefix: string; isActive: boolean; createdAt: string }> =
    preExisting.map((k) => ({ id: k, name: stubName(k), keyPrefix: k.slice(0, 8), isActive: true, createdAt: 'x' }))
  return {
    created,
    repo: {
      async listMeta() { return store },
      async create(name: string, key: string) {
        created.push(key)
        const entry = { id: key, name, keyPrefix: key.slice(0, 8), isActive: true, createdAt: 'x' }
        store.push(entry)
        return entry
      },
    } as any,
  }
}

describe('migrateClientKeys', () => {
  it('明文非空 → 逐个 create + 清 settings', async () => {
    const { created, repo } = stubRepo()
    let cleared = false
    await migrateClientKeys(['sk-a', 'sk-b'], repo, () => { cleared = true })
    expect(created).toEqual(['sk-a', 'sk-b'])
    expect(cleared).toBe(true)
  })
  it('明文空 → no-op（不清）', async () => {
    const { created, repo } = stubRepo()
    let cleared = false
    await migrateClientKeys([], repo, () => { cleared = true })
    expect(created).toEqual([])
    expect(cleared).toBe(false)
  })
  it('重复迁移相同 key 不产生重复 entry', async () => {
    const keys = ['sk-a', 'sk-b']
    const { created, repo } = stubRepo()
    // 第一次迁移
    await migrateClientKeys(keys, repo, () => {})
    expect(created).toEqual(['sk-a', 'sk-b'])
    // 第二次迁移相同 keys（模拟重启重跑）
    await migrateClientKeys(keys, repo, () => {})
    // create 不应再被调用（跳过已存在的 name）
    expect(created).toEqual(['sk-a', 'sk-b'])
  })
  it('部分已存在时仅创建缺失的', async () => {
    // 预先存入 sk-a
    const { created, repo } = stubRepo(['sk-a'])
    await migrateClientKeys(['sk-a', 'sk-b'], repo, () => {})
    // 只应新建 sk-b
    expect(created).toEqual(['sk-b'])
  })
})
