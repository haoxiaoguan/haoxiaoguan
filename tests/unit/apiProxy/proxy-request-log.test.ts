import { describe, it, expect } from 'vitest'
import {
  ProxyRequestLog,
  type ProxyRequestRecordInput,
} from '../../../src/main/contexts/apiProxy/domain/observability/proxy-request-log'

function input(over: Partial<ProxyRequestRecordInput> = {}): ProxyRequestRecordInput {
  return {
    method: 'POST',
    path: '/v1/messages',
    format: 'anthropic',
    action: 'messages',
    stream: false,
    status: 200,
    ok: true,
    durationMs: 12,
    attempts: 1,
    ...over,
  }
}

describe('ProxyRequestLog', () => {
  it('生成单调 seq 与 clock 时间戳', () => {
    let t = 100
    const log = new ProxyRequestLog({ clock: () => t })
    const a = log.record(input())
    t = 250
    const b = log.record(input())
    expect(a.seq).toBe(1)
    expect(a.tsMs).toBe(100)
    expect(b.seq).toBe(2)
    expect(b.tsMs).toBe(250)
  })

  it('环形缓冲满则淘汰最旧（保留最近 capacity 条）', () => {
    const log = new ProxyRequestLog({ capacity: 3, clock: () => 0 })
    for (let i = 0; i < 5; i++) log.record(input({ path: `/r${i}` }))
    const recent = log.listRecent()
    expect(recent.map((r) => r.path)).toEqual(['/r2', '/r3', '/r4'])
    expect(recent.map((r) => r.seq)).toEqual([3, 4, 5])
  })

  it('listRecent(limit) 取最近 N 条；limit<=0 返回空；超量返回全部', () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    for (let i = 0; i < 4; i++) log.record(input({ path: `/r${i}` }))
    expect(log.listRecent(2).map((r) => r.path)).toEqual(['/r2', '/r3'])
    expect(log.listRecent(0)).toEqual([])
    expect(log.listRecent(99)).toHaveLength(4)
  })

  it('计数器累加 success/failed 与 input/output tokens', () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    log.record(input({ ok: true, inputTokens: 10, outputTokens: 5 }))
    log.record(input({ ok: false, status: 502, inputTokens: 3 }))
    log.record(input({ ok: true, inputTokens: 7, outputTokens: 4 }))
    const c = log.counters()
    expect(c.requestsTotal).toBe(3)
    expect(c.successTotal).toBe(2)
    expect(c.failedTotal).toBe(1)
    expect(c.inputTokensTotal).toBe(20)
    expect(c.outputTokensTotal).toBe(9)
  })

  it('errorMessage 写入前脱敏（剥 Bearer token）', () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    const rec = log.record(
      input({ ok: false, status: 401, errorMessage: 'upstream rejected Authorization: Bearer sk-abc123xyz' }),
    )
    expect(rec.errorMessage).toContain('Bearer [REDACTED]')
    expect(rec.errorMessage).not.toContain('sk-abc123xyz')
  })

  it('clear() 清空环形缓冲但计数器保持单调', () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    log.record(input())
    log.record(input({ ok: false, status: 500 }))
    log.clear()
    expect(log.listRecent()).toEqual([])
    const c = log.counters()
    expect(c.requestsTotal).toBe(2)
    expect(c.failedTotal).toBe(1)
  })

  it('setListener 推送新记录；监听器抛错不影响 record', () => {
    const log = new ProxyRequestLog({ clock: () => 0 })
    const seen: number[] = []
    log.setListener((r) => {
      seen.push(r.seq)
      if (r.seq === 1) throw new Error('boom')
    })
    expect(() => log.record(input())).not.toThrow()
    log.record(input())
    expect(seen).toEqual([1, 2])
    log.setListener(null)
    log.record(input())
    expect(seen).toEqual([1, 2])
  })

  it('markStarted/markStopped 控制 startedAtMs', () => {
    let t = 1000
    const log = new ProxyRequestLog({ clock: () => t })
    expect(log.counters().startedAtMs).toBeNull()
    log.markStarted()
    expect(log.counters().startedAtMs).toBe(1000)
    t = 2000
    log.markStopped()
    expect(log.counters().startedAtMs).toBeNull()
  })
})
