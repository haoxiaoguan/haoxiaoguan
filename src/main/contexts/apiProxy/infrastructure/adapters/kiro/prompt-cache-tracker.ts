// Anthropic prompt-cache 计费的反代侧本地模拟（有状态）。
// 账号级 sha256 指纹表 + TTL；compute（读，算命中）与 update（写，请求成功后）分离，避免自命中。
import { createHash } from 'node:crypto'

const ONE_HOUR = 60 * 60 * 1000
const DEFAULT_TTL = 5 * 60 * 1000
const DEFAULT_MIN_CACHEABLE = 1024
const OPUS_MIN_CACHEABLE = 4096
const MAX_CACHE_RATIO = 0.85
const MAX_ENTRIES_PER_ACCOUNT = 200
const PRUNE_INTERVAL = 60 * 1000

export interface CacheBreakpointInput {
  value: string
  tokens: number
  ttl: number
  isMessageEnd: boolean
}

export interface CacheUsage {
  cacheCreationInputTokens: number
  cacheReadInputTokens: number
  cacheCreation5mTokens: number
  cacheCreation1hTokens: number
}

interface Breakpoint { fingerprint: string; cumulativeTokens: number; ttl: number }
export interface CacheProfile { breakpoints: Breakpoint[]; totalInputTokens: number; model: string }
interface Entry { expiresAt: number; ttl: number }

const EMPTY: CacheUsage = { cacheCreationInputTokens: 0, cacheReadInputTokens: 0, cacheCreation5mTokens: 0, cacheCreation1hTokens: 0 }

export class PromptCacheTracker {
  private readonly byAccount = new Map<string, Map<string, Entry>>()
  private lastPrune = 0

  buildProfile(blocks: CacheBreakpointInput[], totalInputTokens: number, model: string): CacheProfile | null {
    if (blocks.length === 0) return null
    const hasher = createHash('sha256')
    const breakpoints: Breakpoint[] = []
    let cumulative = 0
    let activeTTL = 0
    for (const block of blocks) {
      hasher.update(`${block.value.length} ${block.value} `)
      cumulative += block.tokens
      let bpTTL = 0
      if (block.ttl > 0) { bpTTL = block.ttl; activeTTL = block.ttl }
      else if (block.isMessageEnd && activeTTL > 0) bpTTL = activeTTL
      if (bpTTL <= 0) continue
      breakpoints.push({ fingerprint: hasher.copy().digest('hex'), cumulativeTokens: cumulative, ttl: bpTTL })
    }
    if (breakpoints.length === 0) return null
    return { breakpoints, totalInputTokens: Math.max(totalInputTokens, cumulative), model }
  }

  compute(accountId: string, profile: CacheProfile | null, nowMs: number): CacheUsage {
    if (profile === null || profile.breakpoints.length === 0 || accountId === '') return EMPTY
    this.pruneIfNeeded(nowMs)
    const minTokens = this.minCacheable(profile.model)
    const last = profile.breakpoints[profile.breakpoints.length - 1]
    let lastTokens = Math.min(last.cumulativeTokens, profile.totalInputTokens)
    const entries = this.byAccount.get(accountId)

    if (entries === undefined || entries.size === 0) {
      const creation = lastTokens >= minTokens ? lastTokens : 0
      const [c5, c1] = this.ttlBreakdown(profile, 0)
      return { cacheCreationInputTokens: creation, cacheReadInputTokens: 0, cacheCreation5mTokens: c5, cacheCreation1hTokens: c1 }
    }
    const maxCacheable = Math.floor(profile.totalInputTokens * MAX_CACHE_RATIO)
    if (lastTokens > maxCacheable) lastTokens = maxCacheable

    let matched = 0
    for (let i = profile.breakpoints.length - 1; i >= 0; i--) {
      const bp = profile.breakpoints[i]
      if (bp.cumulativeTokens < minTokens) continue
      const entry = entries.get(bp.fingerprint)
      if (entry === undefined || entry.expiresAt < nowMs) continue
      entry.expiresAt = nowMs + entry.ttl
      matched = Math.min(bp.cumulativeTokens, profile.totalInputTokens)
      if (matched > lastTokens) matched = lastTokens
      break
    }
    const creation = Math.max(lastTokens - matched, 0)
    const [c5, c1] = this.ttlBreakdown(profile, matched)
    return { cacheCreationInputTokens: creation, cacheReadInputTokens: matched, cacheCreation5mTokens: c5, cacheCreation1hTokens: c1 }
  }

  update(accountId: string, profile: CacheProfile | null, nowMs: number): void {
    if (profile === null || profile.breakpoints.length === 0 || accountId === '') return
    const minTokens = this.minCacheable(profile.model)
    let entries = this.byAccount.get(accountId)
    if (entries === undefined) { entries = new Map(); this.byAccount.set(accountId, entries) }
    for (const bp of profile.breakpoints) {
      if (bp.cumulativeTokens < minTokens) continue
      entries.set(bp.fingerprint, { expiresAt: nowMs + bp.ttl, ttl: bp.ttl })
    }
    if (entries.size > MAX_ENTRIES_PER_ACCOUNT) {
      const sorted = [...entries.entries()].sort((a, b) => a[1].expiresAt - b[1].expiresAt)
      for (const [k] of sorted.slice(0, entries.size - MAX_ENTRIES_PER_ACCOUNT)) entries.delete(k)
    }
  }

  private minCacheable(model: string): number {
    return model.toLowerCase().includes('opus') ? OPUS_MIN_CACHEABLE : DEFAULT_MIN_CACHEABLE
  }

  private ttlBreakdown(profile: CacheProfile, matchedTokens: number): [number, number] {
    let c5 = 0
    let c1 = 0
    let prev = matchedTokens
    for (const bp of profile.breakpoints) {
      const cur = Math.min(bp.cumulativeTokens, profile.totalInputTokens)
      if (cur <= prev) continue
      const delta = cur - prev
      if (bp.ttl >= ONE_HOUR) c1 += delta
      else c5 += delta
      prev = cur
    }
    return [c5, c1]
  }

  private pruneIfNeeded(nowMs: number): void {
    if (nowMs - this.lastPrune < PRUNE_INTERVAL) return
    this.lastPrune = nowMs
    for (const [acc, entries] of this.byAccount) {
      for (const [fp, e] of entries) if (e.expiresAt < nowMs) entries.delete(fp)
      if (entries.size === 0) this.byAccount.delete(acc)
    }
  }
}

export const DEFAULT_CACHE_TTL = DEFAULT_TTL
