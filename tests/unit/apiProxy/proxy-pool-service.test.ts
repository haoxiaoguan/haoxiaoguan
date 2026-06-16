import { describe, it, expect } from 'vitest'
import { ProxyPoolService } from '../../../src/main/contexts/apiProxy/application/proxy-pool-service'
import type { ProxyPoolRepository } from '../../../src/main/contexts/apiProxy/infrastructure/account-pool/proxy-pool.repository'

/** 内存假仓储（用 Map 模拟持久化：id → {priority, concurrency, rateLimitCooldownMs}）。 */
function makeFakeRepo(initial: string[] = []) {
  const store = new Map<
    string,
    { priority: number; concurrency: number; rateLimitCooldownMs?: number }
  >(initial.map((id) => [id, { priority: 0, concurrency: 4 }]))
  const repo = {
    async list() {
      return [...store.entries()].map(([accountId, m]) => ({
        accountId,
        priority: m.priority,
        concurrency: m.concurrency,
        rateLimitCooldownMs: m.rateLimitCooldownMs ?? 0,
      }))
    },
    async add(id: string, priority = 0, concurrency = 4, rateLimitCooldownMs = 0) {
      if (!store.has(id)) store.set(id, { priority, concurrency, rateLimitCooldownMs })
    },
    async setPriority(id: string, priority: number) {
      const m = store.get(id)
      if (m) m.priority = priority
    },
    async setConcurrency(id: string, concurrency: number) {
      const m = store.get(id)
      if (m) m.concurrency = concurrency
    },
    async setRateLimitCooldown(ids: string[], ms: number) {
      for (const id of ids) {
        const m = store.get(id)
        if (m) m.rateLimitCooldownMs = ms
      }
    },
    async remove(id: string) {
      store.delete(id)
    },
  }
  return { repo: repo as unknown as ProxyPoolRepository, store }
}

describe('ProxyPoolService', () => {
  it('load 从仓储载入成员到内存', async () => {
    const { repo } = makeFakeRepo(['a', 'b'])
    const svc = new ProxyPoolService(repo)
    expect(svc.isLoaded()).toBe(false)
    await svc.load()
    expect(svc.isLoaded()).toBe(true)
    expect(svc.has('a')).toBe(true)
    expect(svc.has('b')).toBe(true)
    expect(svc.has('c')).toBe(false)
    expect(svc.size()).toBe(2)
  })

  it('add/remove 写穿仓储且更新内存缓存', async () => {
    const { repo, store } = makeFakeRepo()
    const svc = new ProxyPoolService(repo)
    await svc.load()
    await svc.add('x')
    expect(svc.has('x')).toBe(true)
    expect(store.has('x')).toBe(true)
    await svc.remove('x')
    expect(svc.has('x')).toBe(false)
    expect(store.has('x')).toBe(false)
  })

  it('setPooled true/false 等价 add/remove', async () => {
    const { repo } = makeFakeRepo()
    const svc = new ProxyPoolService(repo)
    await svc.load()
    await svc.setPooled('y', true)
    expect(svc.has('y')).toBe(true)
    await svc.setPooled('y', false)
    expect(svc.has('y')).toBe(false)
  })

  it('listIds 返回当前成员', async () => {
    const { repo } = makeFakeRepo(['a'])
    const svc = new ProxyPoolService(repo)
    await svc.load()
    await svc.add('b')
    expect(new Set(svc.listIds())).toEqual(new Set(['a', 'b']))
  })

  it('load 载入成员优先级/并发；getPriority/getConcurrency 返回值（不在池=默认）', async () => {
    const { repo, store } = makeFakeRepo()
    store.set('a', { priority: 5, concurrency: 2 })
    store.set('b', { priority: 0, concurrency: 4 })
    const svc = new ProxyPoolService(repo)
    await svc.load()
    expect(svc.getPriority('a')).toBe(5)
    expect(svc.getConcurrency('a')).toBe(2)
    expect(svc.getPriority('b')).toBe(0)
    expect(svc.getPriority('missing')).toBe(0)
    expect(svc.getConcurrency('missing')).toBe(4) // 默认
  })

  it('setPriority 写穿仓储 + 更新内存（仅对在池账号生效）', async () => {
    const { repo, store } = makeFakeRepo(['a'])
    const svc = new ProxyPoolService(repo)
    await svc.load()
    await svc.setPriority('a', 8)
    expect(svc.getPriority('a')).toBe(8)
    expect(store.get('a')?.priority).toBe(8)
    // 非成员：无副作用
    await svc.setPriority('ghost', 3)
    expect(svc.getPriority('ghost')).toBe(0)
    expect(store.has('ghost')).toBe(false)
  })

  it('setConcurrency 写穿仓储 + 更新内存（仅对在池账号生效）', async () => {
    const { repo, store } = makeFakeRepo(['a'])
    const svc = new ProxyPoolService(repo)
    await svc.load()
    await svc.setConcurrency('a', 10)
    expect(svc.getConcurrency('a')).toBe(10)
    expect(store.get('a')?.concurrency).toBe(10)
    // 非成员：无副作用
    await svc.setConcurrency('ghost', 9)
    expect(store.has('ghost')).toBe(false)
  })

  it('add 带优先级/并发；已在池再 add 保留既有配置', async () => {
    const { repo } = makeFakeRepo()
    const svc = new ProxyPoolService(repo)
    await svc.load()
    await svc.add('a', 4, 6)
    expect(svc.getPriority('a')).toBe(4)
    expect(svc.getConcurrency('a')).toBe(6)
    await svc.add('a', 9, 1) // 已在池 → 不覆盖
    expect(svc.getPriority('a')).toBe(4)
    expect(svc.getConcurrency('a')).toBe(6)
  })

  it('setRateLimitCooldown 批量写穿 + 更新内存（仅对在池账号生效，返回生效 id）', async () => {
    const { repo, store } = makeFakeRepo(['a', 'b'])
    const svc = new ProxyPoolService(repo)
    await svc.load()
    expect(svc.getRateLimitCooldownMs('a')).toBe(0) // 默认 0=用全局
    const affected = await svc.setRateLimitCooldown(['a', 'b', 'ghost'], 5000)
    expect(new Set(affected)).toEqual(new Set(['a', 'b'])) // ghost 不在池被过滤
    expect(svc.getRateLimitCooldownMs('a')).toBe(5000)
    expect(svc.getRateLimitCooldownMs('b')).toBe(5000)
    expect(store.get('a')?.rateLimitCooldownMs).toBe(5000)
    expect(store.has('ghost')).toBe(false)
    // -1（不冷却）也可设置
    await svc.setRateLimitCooldown(['a'], -1)
    expect(svc.getRateLimitCooldownMs('a')).toBe(-1)
    // 不在池账号默认 0
    expect(svc.getRateLimitCooldownMs('missing')).toBe(0)
  })
})
