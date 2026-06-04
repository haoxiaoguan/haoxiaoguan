import { describe, it, expect } from 'vitest'
import { ActivitySyncService } from '../../../src/main/contexts/activity/application/activity-sync-service'
import type { ActivityEventRow, ActivityRepository, ActivityTrendPoint } from '../../../src/main/contexts/activity/domain/activity-repository'
import type { ActivityCollectResult } from '../../../src/main/contexts/sessions/domain/log-event'
import type { SessionSource } from '../../../src/main/contexts/sessions/domain/session-source'

class FakeRepo implements ActivityRepository {
  rows: ActivityEventRow[] = []
  rebuilt = 0
  watermark = 0
  async upsertEvents(rows: ActivityEventRow[]) { this.rows.push(...rows) }
  async rebuildRollups() { this.rebuilt++ }
  async trend(): Promise<ActivityTrendPoint[]> { return [] }
  async readWatermark() { return this.watermark }
  async writeWatermark(v: number) { this.watermark = v }
}

function fakeSource(tool: string, result: ActivityCollectResult): SessionSource {
  return {
    tool: tool as never,
    probe: async () => ({ tool: tool as never, hasSessions: false, count: 0 }),
    scan: async () => ({ items: [], total: 0, offset: 0 }),
    readMessages: async () => [],
    delete: async () => {},
    roots: () => [],
    collectLogEvents: async (opts) =>
      opts?.since !== undefined && opts.since >= result.latestMtime
        ? { events: [], latestMtime: result.latestMtime }
        : result,
  }
}

describe('ActivitySyncService', () => {
  it('归一 + upsert + rebuild + 推进 watermark 到最大 latestMtime', async () => {
    const repo = new FakeRepo()
    const s1 = fakeSource('claude', { events: [{ tool: 'claude', kind: 'session', ts: 1700000000000, sourceKey: 'f1' }], latestMtime: 100 })
    const s2 = fakeSource('codex', { events: [{ tool: 'codex', kind: 'tool_call', ts: 1700000003000, sourceKey: 'c1', name: 'shell' }], latestMtime: 250 })
    const svc = new ActivitySyncService([s1, s2], repo)
    const out = await svc.syncAll()
    expect(out.events).toBe(2)
    expect(repo.rows.map((r) => r.metric).sort()).toEqual(['sessions', 'tool_calls'])
    expect(repo.rebuilt).toBe(1)
    expect(repo.watermark).toBe(250)
  })

  it('某 source 抛错不影响其它 source', async () => {
    const repo = new FakeRepo()
    const bad: SessionSource = { ...fakeSource('claude', { events: [], latestMtime: 0 }), collectLogEvents: async () => { throw new Error('boom') } }
    const good = fakeSource('codex', { events: [{ tool: 'codex', kind: 'session', ts: 1700000000000, sourceKey: 'g' }], latestMtime: 50 })
    const svc = new ActivitySyncService([bad, good], repo)
    const out = await svc.syncAll()
    expect(out.events).toBe(1)
    expect(repo.watermark).toBe(50)
  })
})
