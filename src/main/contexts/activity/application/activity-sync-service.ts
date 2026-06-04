// src/main/contexts/activity/application/activity-sync-service.ts
import type { SessionSource } from '../../sessions/domain/session-source'
import type { ActivityEventRow, ActivityRepository } from '../domain/activity-repository'
import { rawEventToRow } from '../domain/activity-event-map'

export class ActivitySyncService {
  constructor(
    private readonly sources: SessionSource[],
    private readonly repo: ActivityRepository,
  ) {}

  /** 增量扫所有 source → 归一 → upsert → 重算 rollup → 推进 watermark。 */
  async syncAll(): Promise<{ events: number }> {
    const since = await this.repo.readWatermark()
    let maxMtime = since
    const rows: ActivityEventRow[] = []
    for (const src of this.sources) {
      let result
      try {
        result = await src.collectLogEvents({ since })
      } catch {
        continue // 单 source 失败不影响其它
      }
      if (result.latestMtime > maxMtime) maxMtime = result.latestMtime
      for (const e of result.events) rows.push(rawEventToRow(e))
    }
    await this.repo.upsertEvents(rows)
    await this.repo.rebuildRollups()
    await this.repo.writeWatermark(maxMtime)
    return { events: rows.length }
  }
}
