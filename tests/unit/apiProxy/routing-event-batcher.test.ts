import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { RoutingEventBatcher } from '../../../src/main/contexts/apiProxy/infrastructure/observability/routing-event-batcher'
import type { RoutingEvent } from '../../../src/main/contexts/apiProxy/domain/observability/routing-event'

function ev(seq: number): RoutingEvent {
  return {
    seq,
    tsMs: 1_700_000_000_000 + seq,
    method: 'POST',
    path: '/v1/messages',
    format: 'anthropic',
    action: 'messages',
    stream: true,
    status: 200,
    ok: true,
    errorKind: 'none',
    durationMs: 10,
    attempts: 1,
  }
}

describe('RoutingEventBatcher', () => {
  beforeEach(() => vi.useFakeTimers())
  afterEach(() => vi.useRealTimers())

  it('200ms 窗口内多次 push 合并为一批 emit', () => {
    const emit = vi.fn()
    const b = new RoutingEventBatcher(emit, 200)
    b.push(ev(1))
    b.push(ev(2))
    b.push(ev(3))
    expect(emit).not.toHaveBeenCalled() // 窗口未到，未推
    vi.advanceTimersByTime(200)
    expect(emit).toHaveBeenCalledOnce()
    expect((emit.mock.calls[0]![0] as RoutingEvent[]).map((e) => e.seq)).toEqual([1, 2, 3])
  })

  it('每个窗口独立计时：跨窗口分两批', () => {
    const emit = vi.fn()
    const b = new RoutingEventBatcher(emit, 200)
    b.push(ev(1))
    vi.advanceTimersByTime(200)
    b.push(ev(2))
    vi.advanceTimersByTime(200)
    expect(emit).toHaveBeenCalledTimes(2)
    expect((emit.mock.calls[1]![0] as RoutingEvent[]).map((e) => e.seq)).toEqual([2])
  })

  it('空缓冲 flush 不 emit', () => {
    const emit = vi.fn()
    const b = new RoutingEventBatcher(emit, 200)
    b.flush()
    expect(emit).not.toHaveBeenCalled()
  })

  it('dispose 清定时器：到点不再 emit', () => {
    const emit = vi.fn()
    const b = new RoutingEventBatcher(emit, 200)
    b.push(ev(1))
    b.dispose()
    vi.advanceTimersByTime(500)
    expect(emit).not.toHaveBeenCalled()
  })

  it('emit 抛错被吞，不冒泡', () => {
    const emit = vi.fn(() => {
      throw new Error('window destroyed')
    })
    const b = new RoutingEventBatcher(emit, 200)
    b.push(ev(1))
    expect(() => vi.advanceTimersByTime(200)).not.toThrow()
  })
})
