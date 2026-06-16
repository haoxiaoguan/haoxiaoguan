// 反代池全局选号配置 IPC：读取/保存 轮询策略 · 亲密度 · 每账号并发。
// 保存时双写：持久化到 app settings（重启保留）+ 热更内存中的 AccountPoolSelector（即时生效）。
import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { API_PROXY_CHANNELS } from '../../../../shared/ipc-channels'
import type { ApiProxySelectionConfigDto } from '../../../../shared/api-types'
import type { AccountPoolSelector } from '../domain/account-selection/account-pool-selector'
import type { SettingsApplicationService } from '../../settings/application/settings-service'

export interface ProxyPoolConfigDeps {
  selector: AccountPoolSelector
  settings: SettingsApplicationService
}

function clampStrategy(v: unknown): 'sticky-lru' | 'round-robin' {
  return v === 'round-robin' ? 'round-robin' : 'sticky-lru'
}

export function registerProxyPoolConfigHandlers(deps: ProxyPoolConfigDeps): void {
  const { selector, settings } = deps

  ipcMain.handle(
    API_PROXY_CHANNELS.getSelectionConfig,
    async (): Promise<ApiProxySelectionConfigDto> => {
      try {
        return {
          strategy: settings.getApiProxySelectionStrategy(),
          affinityTtlMs: settings.getApiProxyAffinityTtlMs(),
          rateLimitCooldownMs: settings.getApiProxyRateLimitCooldownMs(),
        }
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    API_PROXY_CHANNELS.setSelectionConfig,
    async (_e, cfg: ApiProxySelectionConfigDto): Promise<void> => {
      try {
        const strategy = clampStrategy(cfg?.strategy)
        const affinityTtlMs = Math.max(0, Math.trunc(Number(cfg?.affinityTtlMs) || 0))
        const rateLimitCooldownMs = Math.max(0, Math.trunc(Number(cfg?.rateLimitCooldownMs) || 0))
        await settings.updateSettings({
          api_proxy_selection_strategy: strategy,
          api_proxy_affinity_ttl_ms: String(affinityTtlMs),
          api_proxy_rate_limit_cooldown_ms: String(rateLimitCooldownMs),
        })
        // 全局冷却由 health resolver 实时读 settings，无需热更内存对象；仅热更 selector 的策略/亲密度。
        selector.updateOpts({ strategy, affinityTtlMs })
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
