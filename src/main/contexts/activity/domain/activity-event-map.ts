// src/main/contexts/activity/domain/activity-event-map.ts
import type { RawLogEvent, RawLogEventKind } from '../../sessions/domain/log-event'
import type { ActivityEventRow } from './activity-repository'

export function metricForKind(kind: RawLogEventKind): string {
  if (kind === 'session') return 'sessions'
  if (kind === 'code_edit') return 'code_lines'
  return 'tool_calls'
}

export function rawEventToRow(e: RawLogEvent): ActivityEventRow {
  return {
    sourceKey: e.sourceKey,
    tool: e.tool,
    metric: metricForKind(e.kind),
    occurredAt: Math.floor(e.ts / 1000),
    amount: e.amount ?? 1,
  }
}
