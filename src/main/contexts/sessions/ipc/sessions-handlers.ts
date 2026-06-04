import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { SESSIONS_CHANNELS } from '../../../../shared/ipc-channels'
import type { SessionsService, DeleteRequest, DeleteOutcome } from '../application/sessions-service'
import type { SessionMessage, SessionPage, SessionTool, ToolProbe } from '../domain/session'

export function registerSessionsHandlers(svc: SessionsService): void {
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
}
