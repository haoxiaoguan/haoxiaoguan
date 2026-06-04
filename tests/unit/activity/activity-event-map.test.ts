// tests/unit/activity/activity-event-map.test.ts
import { describe, it, expect } from 'vitest'
import { rawEventToRow, metricForKind } from '../../../src/main/contexts/activity/domain/activity-event-map'

describe('activity-event-map', () => {
  it('kind → metric', () => {
    expect(metricForKind('session')).toBe('sessions')
    expect(metricForKind('tool_call')).toBe('tool_calls')
  })
  it('rawEventToRow：occurredAt 取毫秒地板除 1000', () => {
    const row = rawEventToRow({ tool: 'claude', kind: 'tool_call', ts: 1700000000500, sourceKey: 'k', name: 'Edit' })
    expect(row).toEqual({ sourceKey: 'k', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000, amount: 1 })
  })
  it('code_edit → code_lines，透传 amount', () => {
    expect(metricForKind('code_edit')).toBe('code_lines')
    const row = rawEventToRow({ tool: 'claude', kind: 'code_edit', ts: 1700000000000, sourceKey: 'k', amount: 12 })
    expect(row).toEqual({ sourceKey: 'k', tool: 'claude', metric: 'code_lines', occurredAt: 1700000000, amount: 12 })
  })
  it('无 amount 的事件默认 amount=1', () => {
    const row = rawEventToRow({ tool: 'claude', kind: 'tool_call', ts: 1700000000000, sourceKey: 'k' })
    expect(row.amount).toBe(1)
  })
})
