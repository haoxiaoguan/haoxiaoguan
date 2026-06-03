// 客户端 API Key 令牌桶限流器（纯函数 + 可注入 clock，无副作用外部依赖）。
// 每个 keyId 独立维护一个令牌桶；匿名回环请求（无 keyId）不经本模块。
// 注意：clock 可注入（方便测试时加速时间），生产使用默认 Date.now。

export interface KeyRateLimiterConfig {
  /** 桶容量（最大 burst token 数） */
  capacity: number
  /** 每分钟补充 token 数量 */
  refillPerMinute: number
  /** 可注入的时钟函数，返回毫秒时间戳；默认 Date.now */
  clock?: () => number
}

export type RateLimitDecision = { ok: true } | { ok: false; retryAfterSec: number }

interface BucketState {
  tokens: number
  lastRefillMs: number
}

/**
 * 令牌桶限流器。线程安全前提：Node.js 单线程事件循环（无需锁）。
 * tryAcquire 先 refill 再消费；不足时返回距下一个 token 的等待秒数。
 */
export class KeyRateLimiter {
  private readonly capacity: number
  private readonly refillPerMinute: number
  private readonly clock: () => number
  private readonly buckets = new Map<string, BucketState>()

  constructor(config: KeyRateLimiterConfig) {
    this.capacity = config.capacity
    this.refillPerMinute = config.refillPerMinute
    this.clock = config.clock ?? (() => Date.now())
  }

  tryAcquire(keyId: string): RateLimitDecision {
    const now = this.clock()
    let bucket = this.buckets.get(keyId)
    if (bucket === undefined) {
      bucket = { tokens: this.capacity, lastRefillMs: now }
      this.buckets.set(keyId, bucket)
    }

    // refill：按经过的时间比例补充 token（上限 capacity）
    const elapsedMs = now - bucket.lastRefillMs
    if (elapsedMs > 0) {
      const refilled = (elapsedMs / 60_000) * this.refillPerMinute
      bucket.tokens = Math.min(this.capacity, bucket.tokens + refilled)
      bucket.lastRefillMs = now
    }

    if (bucket.tokens >= 1) {
      bucket.tokens -= 1
      return { ok: true }
    }

    // 距下一个 token 的等待时间（秒，向上取整，最小 1）
    const msPerToken = 60_000 / this.refillPerMinute
    const msToNext = msPerToken - elapsedMs
    const retryAfterSec = Math.max(1, Math.ceil(msToNext / 1000))
    return { ok: false, retryAfterSec }
  }
}
