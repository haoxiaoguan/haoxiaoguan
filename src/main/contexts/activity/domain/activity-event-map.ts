// src/main/contexts/activity/domain/activity-event-map.ts
import type { RawLogEvent, RawLogEventKind } from '../../sessions/domain/log-event'
import type { ActivityEventRow } from './activity-repository'

export function metricForKind(kind: RawLogEventKind): string {
  return kind === 'session' ? 'sessions' : 'tool_calls'
}

export function rawEventToRow(e: RawLogEvent): ActivityEventRow {
  return {
    sourceKey: e.sourceKey,
    tool: e.tool,
    metric: metricForKind(e.kind),
    occurredAt: Math.floor(e.ts / 1000),
  }
}
