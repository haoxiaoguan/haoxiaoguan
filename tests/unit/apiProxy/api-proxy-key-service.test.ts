import { describe, it, expect } from 'vitest'
import { ApiProxyKeyService } from '../../../src/main/contexts/apiProxy/application/api-proxy-key-service'

function stubRepo() {
  const store: any[] = []
  return {
    store,
    repo: {
      async create(name: string, plaintext: string) { const m = { id: `id${store.length}`, name, keyPrefix: plaintext.slice(0, 8), isActive: true, createdAt: '2026-06-03' }; store.push({ ...m, plaintext }); return m },
      async listMeta() { return store.map(({ plaintext, ...m }) => m) },
      async setActive(id: string, a: boolean) { const e = store.find((s) => s.id === id); if (e) e.isActive = a },
      async delete(id: string) { const i = store.findIndex((s) => s.id === id); if (i >= 0) store.splice(i, 1) },
    } as any,
  }
}

describe('ApiProxyKeyService', () => {
  it('create 生成明文并回显一次', async () => {
    const { repo } = stubRepo()
    const svc = new ApiProxyKeyService(repo)
    const res = await svc.create('k1')
    expect(res.plaintext).toMatch(/^sk-hxg-/)
    expect(res.meta.keyPrefix).toBe(res.plaintext.slice(0, 8))
  })
  it('list / setActive / delete 透传', async () => {
    const { repo } = stubRepo()
    const svc = new ApiProxyKeyService(repo)
    const { meta } = await svc.create('k1')
    expect((await svc.list())).toHaveLength(1)
    await svc.setActive(meta.id, false)
    expect((await svc.list())[0].isActive).toBe(false)
    await svc.delete(meta.id)
    expect((await svc.list())).toHaveLength(0)
  })
})
