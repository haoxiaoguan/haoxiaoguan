import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { ACTIVITY_CHANNELS } from '../../../../shared/ipc-channels'
import type { ActivitySyncService } from '../application/activity-sync-service'
import type { ActivityQueryService } from '../application/activity-query-service'

export function registerActivityHandlers(
  sync: ActivitySyncService,
  query: ActivityQueryService,
): void {
  ipcMain.handle(ACTIVITY_CHANNELS.syncActivity, async () => {
    try {
      return await sync.syncAll()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(ACTIVITY_CHANNELS.getActivityTrend, async (_e, range: string, metric: string) => {
    try {
      return await query.trend(range, metric)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
