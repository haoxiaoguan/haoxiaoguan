/**
 * conversationId 稳定复用缓存（P2-2）。
 * 同一 key 在 TTL 内返回相同 id；超期或首次访问调用 genId() 生成新值。
 * 超出 maxEntries 时淘汰最早到期的条目（按 expiresAt 升序，不保证 LRU 严格语义）。
 * clock 注入便于测试（禁直接调用 Date.now）。
 */
export interface ConversationIdCacheOpts {
  ttlMs: number
  maxEntries: number
  clock?: () => number
}

interface Entry {
  id: string
  expiresAt: number
}

export class ConversationIdCache {
  private readonly ttlMs: number
  private readonly maxEntries: number
  private readonly clock: () => number
  private readonly map = new Map<string, Entry>()

  constructor(opts: ConversationIdCacheOpts) {
    this.ttlMs = opts.ttlMs
    this.maxEntries = opts.maxEntries
    this.clock = opts.clock ?? Date.now
  }

  /**
   * 返回 key 对应的稳定 conversationId。
   * - 命中且未过期 → 返回旧 id（genId 不调用）。
   * - 首次或已过期 → 调用 genId() 生成新 id，缓存后返回。
   */
  getOrCreate(key: string, genId: () => string): string {
    const now = this.clock()
    const existing = this.map.get(key)
    if (existing !== undefined && existing.expiresAt > now) {
      return existing.id
    }
    // 生成新 id 前先按需淘汰（size 含将要写入的 key，若 key 已存在则覆盖不增 size）。
    if (!this.map.has(key) && this.map.size >= this.maxEntries) {
      this.evictOldest()
    }
    const id = genId()
    this.map.set(key, { id, expiresAt: now + this.ttlMs })
    return id
  }

  /** 淘汰 expiresAt 最小的条目（超容时）。 */
  private evictOldest(): void {
    let oldestKey: string | undefined
    let oldestExpiry = Infinity
    for (const [k, entry] of this.map) {
      if (entry.expiresAt < oldestExpiry) {
        oldestExpiry = entry.expiresAt
        oldestKey = k
      }
    }
    if (oldestKey !== undefined) {
      this.map.delete(oldestKey)
    }
  }
}
