import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { SESSIONS_CHANNELS } from '../../../../shared/ipc-channels'
import type { SessionsService, DeleteRequest, DeleteOutcome } from '../application/sessions-service'
import type { SessionMessage, SessionPage, SessionTool, ToolProbe } from '../domain/session'
import type { CodexRepairRequest } from '../domain/codex-repair'
import { CodexSessionRepair } from '../application/codex-session-repair'

export function registerSessionsHandlers(svc: SessionsService, repair: CodexSessionRepair): void {
  ipcMain.handle(SESSIONS_CHANNELS.probeTools, async (): Promise<ToolProbe[]> => {
    try {
      return await svc.probeTools()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(
    SESSIONS_CHANNELS.listSessions,
    async (_e, args: { tool: SessionTool; limit?: number; offset?: number }): Promise<SessionPage> => {
      try {
        return await svc.listSessions(args.tool, { limit: args.limit, offset: args.offset })
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
  ipcMain.handle(
    SESSIONS_CHANNELS.getMessages,
    async (_e, args: { tool: SessionTool; sourcePath: string }): Promise<SessionMessage[]> => {
      try {
        return await svc.getMessages(args.tool, args.sourcePath)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
  ipcMain.handle(
    SESSIONS_CHANNELS.deleteSession,
    async (_e, args: { tool: SessionTool; sourcePath: string; sessionId: string }): Promise<void> => {
      try {
        await svc.deleteSession(args.tool, args.sourcePath, args.sessionId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
  ipcMain.handle(
    SESSIONS_CHANNELS.deleteSessions,
    async (_e, args: { items: DeleteRequest[] }): Promise<DeleteOutcome[]> => {
      try {
        return await svc.deleteSessions(args.items)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
  ipcMain.handle(
    SESSIONS_CHANNELS.resume,
    async (_e, args: { command: string; cwd?: string }): Promise<void> => {
      try {
        svc.resume(args.command, args.cwd)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
  ipcMain.handle(SESSIONS_CHANNELS.repairPreview, async () => {
    try { return await repair.preview() } catch (e) { throw new Error(toIpcError(e)) }
  })
  ipcMain.handle(SESSIONS_CHANNELS.repair, async (_e, req: CodexRepairRequest) => {
    try { return await repair.repair(req) } catch (e) { throw new Error(toIpcError(e)) }
  })
  ipcMain.handle(SESSIONS_CHANNELS.repairRollback, async (_e, args: { backupId: string }) => {
    try { await repair.rollback(args.backupId) } catch (e) { throw new Error(toIpcError(e)) }
  })
}
