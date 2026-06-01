import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { PROXY_CHANNELS } from '../../../../shared/ipc-channels'
import { isProxyProtocol, type ProxyProtocol } from '../domain/proxy'
import { ProxyError } from '../domain/proxy-error'
import type {
  ProxyService,
  ProxyDto,
  ProxyGroupDto,
  AccountBindingDto,
  ImportSummary,
  ProxyTestResultDto,
} from '../application/proxy-service'

// registerProxyHandlers — wires the proxy IPC channels. Top-level args are
// camelCase; every handler wraps thrown errors via toIpcError so the renderer
// sees a plain string rejection (Tauri parity). The plaintext password only
// ever travels INBOUND (create/update args) — it is never returned.

export interface CreateProxyArgs {
  label?: string
  protocol: string
  host: string
  port: number
  username?: string
  password?: string
  tags?: string[]
}

export interface UpdateProxyArgs {
  label?: string
  protocol?: string
  host?: string
  port?: number
  username?: string
  password?: string | null
  tags?: string[]
}

function parseProtocol(value: string): ProxyProtocol {
  if (!isProxyProtocol(value)) throw ProxyError.malformedInput('protocol')
  return value
}

export function registerProxyHandlers(proxyService: ProxyService): void {
  ipcMain.handle(PROXY_CHANNELS.listProxies, async (): Promise<ProxyDto[]> => {
    try {
      return await proxyService.listProxies()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    PROXY_CHANNELS.createProxy,
    async (_e, args: CreateProxyArgs): Promise<ProxyDto> => {
      try {
        return await proxyService.createProxy({
          label: args.label,
          protocol: parseProtocol(args.protocol),
          host: args.host,
          port: args.port,
          username: args.username,
          password: args.password,
          tags: args.tags ?? [],
        })
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    PROXY_CHANNELS.updateProxy,
    async (_e, args: { id: string; patch: UpdateProxyArgs }): Promise<ProxyDto> => {
      try {
        return await proxyService.updateProxy(args.id, {
          label: args.patch.label,
          protocol: args.patch.protocol !== undefined ? parseProtocol(args.patch.protocol) : undefined,
          host: args.patch.host,
          port: args.patch.port,
          username: args.patch.username,
          password: args.patch.password,
          tags: args.patch.tags,
        })
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(PROXY_CHANNELS.deleteProxy, async (_e, args: { id: string }): Promise<void> => {
    try {
      await proxyService.deleteProxy(args.id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    PROXY_CHANNELS.importProxies,
    async (_e, args: { text: string }): Promise<ImportSummary> => {
      try {
        return await proxyService.importFromText(args.text)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    PROXY_CHANNELS.testProxy,
    async (_e, args: { id: string }): Promise<ProxyTestResultDto> => {
      try {
        return await proxyService.testProxy(args.id)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    PROXY_CHANNELS.testProxies,
    async (_e, args: { ids: string[]; concurrency?: number }): Promise<ProxyTestResultDto[]> => {
      try {
        return await proxyService.testProxies(args.ids, args.concurrency ?? 4)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(PROXY_CHANNELS.listGroups, async (): Promise<ProxyGroupDto[]> => {
    try {
      return await proxyService.listGroups()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    PROXY_CHANNELS.createGroup,
    async (_e, args: { name: string; proxyId: string }): Promise<ProxyGroupDto> => {
      try {
        return await proxyService.createGroup(args.name, args.proxyId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(PROXY_CHANNELS.deleteGroup, async (_e, args: { id: string }): Promise<void> => {
    try {
      await proxyService.deleteGroup(args.id)
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(PROXY_CHANNELS.listBindings, async (): Promise<AccountBindingDto[]> => {
    try {
      return await proxyService.listBindings()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(
    PROXY_CHANNELS.getAccountBinding,
    async (_e, args: { accountId: string }): Promise<AccountBindingDto | null> => {
      try {
        return await proxyService.getAccountBinding(args.accountId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    PROXY_CHANNELS.bindAccountToProxy,
    async (_e, args: { accountId: string; proxyId: string }): Promise<void> => {
      try {
        await proxyService.bindAccountToProxy(args.accountId, args.proxyId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    PROXY_CHANNELS.bindAccountToGroup,
    async (_e, args: { accountId: string; groupId: string }): Promise<void> => {
      try {
        await proxyService.bindAccountToGroup(args.accountId, args.groupId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    PROXY_CHANNELS.unbindAccount,
    async (_e, args: { accountId: string }): Promise<void> => {
      try {
        await proxyService.unbindAccount(args.accountId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
