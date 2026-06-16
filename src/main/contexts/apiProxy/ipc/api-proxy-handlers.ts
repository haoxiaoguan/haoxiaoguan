import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { API_PROXY_CHANNELS } from '../../../../shared/ipc-channels'
import type { ApiProxyService } from '../application/api-proxy-service'
import type { ApiProxyStatus } from '../../../../shared/api-types'
import type { AccountHealthTracker } from '../domain/account-selection/account-health-tracker'
import type { KiroAccountPort } from '../infrastructure/adapters/kiro/kiro-ports'
import { makeClearSuspensionHandler } from '../application/clear-suspension-handler'
import { makeAccountPoolHealthHandler } from '../application/account-pool-health-handler'
import type { ApiProxyKeyService } from '../application/api-proxy-key-service'
import type { ProxyRequestLog } from '../domain/observability/proxy-request-log'
import type { ComboService } from '../application/combo-service'
import type { RouteComboInput } from '../infrastructure/route-combo.repository'
import type { ProxyPoolService } from '../application/proxy-pool-service'
import type { RoutingLogService } from '../application/routing-log-service'
import type { RoutingWindow } from '../domain/observability/routing-log-record'

// 注册 apiProxy 的 IPC handlers：start / stop / getStatus / clearAccountSuspension。
// start/stop 均返回最新状态投影，方便 renderer 一次拿到结果免再查。
export function registerApiProxyHandlers(
  svc: ApiProxyService,
  health?: AccountHealthTracker,
  accounts?: KiroAccountPort,
  keyService?: ApiProxyKeyService,
  quotaResetMs?: number,
  requestLog?: ProxyRequestLog,
  combos?: ComboService,
  pool?: ProxyPoolService,
  routingLog?: RoutingLogService,
  refreshModels?: () => Promise<void>,
): void {
  ipcMain.handle(API_PROXY_CHANNELS.start, async (): Promise<ApiProxyStatus> => {
    try {
      await svc.start()
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(API_PROXY_CHANNELS.stop, async (): Promise<ApiProxyStatus> => {
    try {
      await svc.stop()
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  ipcMain.handle(API_PROXY_CHANNELS.getStatus, async (): Promise<ApiProxyStatus> => {
    try {
      return svc.getStatus()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  if (health && accounts) {
    const clearSuspensionHandler = makeClearSuspensionHandler(health, accounts)
    ipcMain.handle(
      API_PROXY_CHANNELS.clearAccountSuspension,
      async (_e, accountId: string): Promise<void> => {
        try {
          await clearSuspensionHandler(accountId)
        } catch (e) {
          throw new Error(toIpcError(e))
        }
      },
    )

    const poolHealthHandler = makeAccountPoolHealthHandler({
      health,
      accounts,
      quotaResetMs: quotaResetMs ?? 3_600_000,
      ...(pool ? { pool } : {}),
      ...(routingLog ? { routingLog } : {}),
    })
    ipcMain.handle(API_PROXY_CHANNELS.getAccountPoolHealth, async (_e, window?: RoutingWindow) => {
      try {
        return await poolHealthHandler(window)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }

  if (pool) {
    ipcMain.handle(
      API_PROXY_CHANNELS.setAccountPooled,
      async (_e, accountId: string, pooled: boolean): Promise<void> => {
        try {
          await pool.setPooled(accountId, pooled)
        } catch (e) {
          throw new Error(toIpcError(e))
        }
      },
    )
    ipcMain.handle(
      API_PROXY_CHANNELS.setAccountPriority,
      async (_e, accountId: string, priority: number): Promise<void> => {
        try {
          await pool.setPriority(accountId, Math.max(0, Math.trunc(Number(priority) || 0)))
        } catch (e) {
          throw new Error(toIpcError(e))
        }
      },
    )
    ipcMain.handle(
      API_PROXY_CHANNELS.setAccountConcurrency,
      async (_e, accountId: string, concurrency: number): Promise<void> => {
        try {
          await pool.setConcurrency(accountId, Math.max(1, Math.trunc(Number(concurrency) || 1)))
        } catch (e) {
          throw new Error(toIpcError(e))
        }
      },
    )
    // 批量设置 429 限流冷却覆盖（ms：0=用全局/-1=不冷却/>0=自定义）。返回实际生效（在池）的 id 列表。
    ipcMain.handle(
      API_PROXY_CHANNELS.setAccountRateLimitCooldown,
      async (_e, accountIds: string[], rateLimitCooldownMs: number): Promise<string[]> => {
        try {
          const ids = Array.isArray(accountIds) ? accountIds.filter((x) => typeof x === 'string') : []
          // 仅允许 -1（不冷却）/ 0（用全局）/ 正整数 ms；其余规整到最近的合法值。
          const raw = Math.trunc(Number(rateLimitCooldownMs))
          const ms = Number.isFinite(raw) ? (raw < 0 ? -1 : raw) : 0
          return await pool.setRateLimitCooldown(ids, ms)
        } catch (e) {
          throw new Error(toIpcError(e))
        }
      },
    )
    ipcMain.handle(API_PROXY_CHANNELS.getPooledAccountIds, async (): Promise<string[]> => {
      try {
        return pool.listIds()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }

  if (keyService) {
    ipcMain.handle(API_PROXY_CHANNELS.createClientKey, async (_e, name: string) => {
      try {
        return await keyService.create(name)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(API_PROXY_CHANNELS.listClientKeys, async () => {
      try {
        return await keyService.list()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(
      API_PROXY_CHANNELS.setClientKeyActive,
      async (_e, id: string, isActive: boolean) => {
        try {
          await keyService.setActive(id, isActive)
        } catch (e) {
          throw new Error(toIpcError(e))
        }
      },
    )
    ipcMain.handle(API_PROXY_CHANNELS.deleteClientKey, async (_e, id: string) => {
      try {
        await keyService.delete(id)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }

  if (requestLog) {
    ipcMain.handle(API_PROXY_CHANNELS.getRequestLog, async (_e, limit?: number) => {
      try {
        return requestLog.listRecent(limit)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(API_PROXY_CHANNELS.clearRequestLog, async (): Promise<void> => {
      try {
        requestLog.clear()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }

  // 路由组合 CRUD + 可路由模型清单（步骤选择器）。listRoutableModels 始终注册（不依赖 combos）。
  ipcMain.handle(API_PROXY_CHANNELS.listRoutableModels, async (): Promise<string[]> => {
    try {
      return svc.listRoutableModels()
    } catch (e) {
      throw new Error(toIpcError(e))
    }
  })

  // 手动刷新 kiro 模型快照（按「会员最高」可用账号重拉 ListAvailableModels 重建）。
  if (refreshModels) {
    ipcMain.handle(API_PROXY_CHANNELS.refreshModels, async (): Promise<void> => {
      try {
        await refreshModels()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }

  if (combos) {
    ipcMain.handle(API_PROXY_CHANNELS.listCombos, async () => {
      try {
        return await combos.listAll()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(API_PROXY_CHANNELS.createCombo, async (_e, input: RouteComboInput) => {
      try {
        return await combos.create(input)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
    ipcMain.handle(
      API_PROXY_CHANNELS.updateCombo,
      async (_e, id: string, patch: Partial<RouteComboInput>) => {
        try {
          return await combos.update(id, patch)
        } catch (e) {
          throw new Error(toIpcError(e))
        }
      },
    )
    ipcMain.handle(API_PROXY_CHANNELS.deleteCombo, async (_e, id: string): Promise<void> => {
      try {
        await combos.remove(id)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    })
  }
}
