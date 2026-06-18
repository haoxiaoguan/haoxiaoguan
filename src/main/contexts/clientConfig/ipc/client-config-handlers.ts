import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { CLIENT_CONFIG_CHANNELS } from '../../../../shared/ipc-channels'
import type { ClientConfigService } from '../application/client-config-service'
import type { ClientVersionService } from '../application/client-version-service'
import type { ClientId } from '../domain/client-profile'
import type { CreateProfileInput, UpdateProfileInput } from '../application/client-config-store'

// 注册 clientConfig 的 IPC handlers：客户端列表 + 接入档 CRUD + 预览/应用/还原 + 历史/回滚 + 版本/可升级。
export function registerClientConfigHandlers(
  svc: ClientConfigService,
  versionSvc: ClientVersionService,
): void {
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.clients, async () => {
    try {
      return svc.listClients()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  // 版本/可升级探测（慢，带 TTL 缓存）：跑 CLI --version + 查 npm/PyPI/GitHub + semver 比对。
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.versions, async () => {
    try {
      return await versionSvc.getVersions()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  // 升级前规划：枚举所有安装 + 锚定升级命令 + 是否需确认（≥2 处）。只读，供 UI 升级前弹窗确认。
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.planUpgrade, async (_e, clientId: ClientId) => {
    try {
      return await versionSvc.planUpgrade(clientId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  // 一键升级：登录 shell 静默跑升级命令 + 升级后重新探测版本（返回结果 + 新版本信息）。
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.upgrade, async (_e, clientId: ClientId) => {
    try {
      return await versionSvc.upgrade(clientId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  // 一键安装（未安装时）：登录 shell 静默跑安装命令 + 完成后重新探测版本。
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.install, async (_e, clientId: ClientId) => {
    try {
      return await versionSvc.install(clientId)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })
  // 多处安装冲突诊断：枚举各客户端 CLI 的所有安装并判定冲突。
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.diagnose, async (_e, clientIds?: ClientId[]) => {
    try {
      return await versionSvc.diagnose(clientIds)
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
    async (_e, input: { clientId: ClientId; baseUrl: string; apiKey?: string; profileId?: string; fullUrl?: boolean }) => {
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
  ipcMain.handle(CLIENT_CONFIG_CHANNELS.setRouting, async (_e, clientId: ClientId, enabled: boolean) => {
    try {
      await svc.setRouting(clientId, enabled)
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
