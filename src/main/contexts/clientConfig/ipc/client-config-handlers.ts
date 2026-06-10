import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { CLIENT_CONFIG_CHANNELS } from '../../../../shared/ipc-channels'
import type { ClientConfigService } from '../application/client-config-service'
import type { ClientId } from '../domain/client-profile'
import type { CreateProfileInput, UpdateProfileInput } from '../application/client-config-store'

// 注册 clientConfig 的 IPC handlers：客户端列表 + 接入档 CRUD + 预览/应用/还原 + 历史/回滚。
export function registerClientConfigHandlers(svc: ClientConfigService): void {
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.clients, async () => {
    try {
      return svc.listClients()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.list, async (_e, clientId?: ClientId) => {
    try {
      return await svc.list(clientId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.create, async (_e, input: CreateProfileInput) => {
    try {
      return await svc.create(input)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.update, async (_e, id: string, patch: UpdateProfileInput) => {
    try {
      await svc.update(id, patch)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.delete, async (_e, id: string) => {
    try {
      await svc.delete(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.preview, async (_e, id: string) => {
    try {
      return await svc.preview(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(
    CLIENT_CONFIG_CHANNELS.previewDraft,
    async (
      _e,
      input: { clientId: ClientId; name: string; baseUrl: string; apiKey?: string; model?: string; settings?: Record<string, unknown> },
    ) => {
      try {
        return await svc.previewDraft(input)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
  ipcMain.handle(
    CLIENT_CONFIG_CHANNELS.fetchModels,
    async (_e, input: { clientId: ClientId; baseUrl: string; apiKey?: string; profileId?: string }) => {
      try {
        return await svc.fetchModels(input)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.apply, async (_e, id: string) => {
    try {
      await svc.apply(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.clear, async (_e, id: string) => {
    try {
      await svc.clear(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.enable, async (_e, id: string) => {
    try {
      await svc.enable(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.disable, async (_e, id: string) => {
    try {
      await svc.disable(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.setDefault, async (_e, clientId: ClientId, id: string) => {
    try {
      await svc.setDefault(clientId, id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.history, async (_e, clientId: ClientId) => {
    try {
      return await svc.history(clientId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.rollback, async (_e, clientId: ClientId, entryId: string) => {
    try {
      await svc.rollback(clientId, entryId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.connectLocalProxy, async (_e, clientId: ClientId) => {
    try {
      return await svc.connectLocalProxy(clientId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.testConnectivity, async (_e, id: string) => {
    try {
      return await svc.testConnectivity(id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.setCodexRelayInjection, async (_e, enabled: boolean) => {
    try {
      await svc.setCodexRelayInjection(enabled)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.setCodexProviderEnabled, async (_e, id: string, enabled: boolean) => {
    try {
      await svc.setCodexProviderEnabled(id, enabled)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
}
