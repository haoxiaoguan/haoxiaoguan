import { describe, it, expect } from 'vitest'
import { migrateClientKeys } from '../../../src/main/contexts/apiProxy/application/migrate-client-keys'

function stubRepo() {
  const created: string[] = []
  return {
    created,
    repo: {
      async create(name: string, key: string) {
        created.push(key)
        return { id: key, name, keyPrefix: key.slice(0, 8), isActive: true, createdAt: 'x' }
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
})
