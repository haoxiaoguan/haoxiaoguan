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
    expect(row).toEqual({ sourceKey: 'k', tool: 'claude', metric: 'tool_calls', occurredAt: 1700000000 })
  })
})
