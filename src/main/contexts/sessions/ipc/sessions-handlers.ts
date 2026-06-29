import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { SESSIONS_CHANNELS, SESSIONS_EVENTS } from '../../../../shared/ipc-channels'
import type { SessionsService, DeleteRequest, DeleteOutcome } from '../application/sessions-service'
import type { SessionMessage, SessionPage, SessionTool, ToolProbe } from '../domain/session'
import type { CodexRepairRequest } from '../domain/codex-repair'
import type { ClaudeDesktopRepairRequest } from '../domain/claude-desktop-repair'
import { CodexSessionRepair } from '../application/codex-session-repair'
import { ClaudeDesktopSessionRepair } from '../application/claude-desktop-session-repair'
import type { ClientConfigService } from '../../clientConfig/application/client-config-service'

export function registerSessionsHandlers(
  svc: SessionsService,
  repair: CodexSessionRepair,
  claudeDesktopRepair: ClaudeDesktopSessionRepair,
  clientConfig: ClientConfigService,
): void {
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
  ipcMain.handle(SESSIONS_CHANNELS.repair, async (event, req: CodexRepairRequest) => {
    try {
      return await repair.repair(req, (p) => event.sender.send(SESSIONS_EVENTS.repairProgress, p))
    } catch (e) { throw new Error(toIpcError(e)) }
  })
  ipcMain.handle(SESSIONS_CHANNELS.repairRollback, async (_e, args: { backupId: string }) => {
    try { await repair.rollback(args.backupId) } catch (e) { throw new Error(toIpcError(e)) }
  })
  ipcMain.handle(SESSIONS_CHANNELS.claudeDesktopRepairPreview, async () => {
    try { return await claudeDesktopRepair.preview() } catch (e) { throw new Error(toIpcError(e)) }
  })
  ipcMain.handle(SESSIONS_CHANNELS.claudeDesktopRepair, async (_event, req: ClaudeDesktopRepairRequest) => {
    try { return await claudeDesktopRepair.repair(req) } catch (e) { throw new Error(toIpcError(e)) }
  })
  ipcMain.handle(SESSIONS_CHANNELS.claudeDesktopRepairRollback, async (_e, args: { backupId: string }) => {
    try { await claudeDesktopRepair.rollback(args.backupId) } catch (e) { throw new Error(toIpcError(e)) }
  })
  // 启用/停用 codex 接入档 + 会话迁移合并为单次 Codex 重启：在一个停-启窗口内先写客户端配置
  // （enable/disable），再把会话迁到生效 provider。进度复用 repairProgress 事件。
  ipcMain.handle(
    SESSIONS_CHANNELS.codexSwitchRepair,
    async (event, args: { id: string; action: 'enable' | 'disable' }) => {
      try {
        const mutation = () =>
          args.action === 'enable' ? clientConfig.enable(args.id) : clientConfig.disable(args.id)
        return await repair.applyConfigThenRepair(mutation, (p) =>
          event.sender.send(SESSIONS_EVENTS.repairProgress, p),
        )
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
