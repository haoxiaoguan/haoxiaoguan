import { describe, it, expect } from 'vitest'
import { ConversationIdCache } from '../../../src/main/contexts/apiProxy/domain/account-selection/conversation-id-cache'

describe('ConversationIdCache', () => {
  it('TTL 内同 key 复用同 id（genId 只调一次）', () => {
    let calls = 0
    const genId = () => { calls++; return `id-${calls}` }
    const clock = { now: 1000 }
    const cache = new ConversationIdCache({ ttlMs: 5000, maxEntries: 100, clock: () => clock.now })

    const id1 = cache.getOrCreate('key-a', genId)
    clock.now = 3000 // 仍在 TTL 内（1000 + 5000 = 6000）
    const id2 = cache.getOrCreate('key-a', genId)

    expect(id1).toBe('id-1')
    expect(id2).toBe('id-1')
    expect(calls).toBe(1)
  })

  it('过期后重新生成新 id', () => {
    let calls = 0
    const genId = () => { calls++; return `id-${calls}` }
    const clock = { now: 1000 }
    const cache = new ConversationIdCache({ ttlMs: 2000, maxEntries: 100, clock: () => clock.now })

    const id1 = cache.getOrCreate('key-b', genId)
    clock.now = 4000 // 超期（1000 + 2000 = 3000 < 4000）
    const id2 = cache.getOrCreate('key-b', genId)

    expect(id1).toBe('id-1')
    expect(id2).toBe('id-2')
    expect(calls).toBe(2)
  })

  it('不同 key 独立（互不干扰）', () => {
    let calls = 0
    const genId = () => { calls++; return `id-${calls}` }
    const clock = { now: 0 }
    const cache = new ConversationIdCache({ ttlMs: 10000, maxEntries: 100, clock: () => clock.now })

    const idA = cache.getOrCreate('key-a', genId)
    const idB = cache.getOrCreate('key-b', genId)
    const idA2 = cache.getOrCreate('key-a', genId)

    expect(idA).toBe('id-1')
    expect(idB).toBe('id-2')
    expect(idA2).toBe('id-1') // key-a 命中缓存，genId 不再调用
    expect(calls).toBe(2)
  })

  it('超 maxEntries 淘汰最早到期的条目', () => {
    let seq = 0
    const genId = () => `g${++seq}`
    let now = 0
    const cache = new ConversationIdCache({ ttlMs: 1000, maxEntries: 2, clock: () => now })

    // 写入两个条目，key-1 到期时间 = 1000，key-2 到期时间 = 2000
    now = 0
    cache.getOrCreate('key-1', genId) // expiresAt=1000
    now = 1000
    cache.getOrCreate('key-2', genId) // expiresAt=2000

    // 此时 map.size == 2 (maxEntries)，写入 key-3 应淘汰 key-1（最早到期）
    now = 1000
    cache.getOrCreate('key-3', genId) // 淘汰 key-1，写入 key-3

    // key-1 已被淘汰 → getOrCreate 触发新 genId
    const idAfter = cache.getOrCreate('key-1', genId)
    expect(idAfter).toMatch(/^g/) // 新生成的 id
    expect(seq).toBe(4) // key-1, key-2, key-3, key-1(淘汰后重建) = 4 次
  })
})
