import { create } from 'zustand'
import type {
  ApiProxyStatus,
  ApiProxyKeyMeta,
  ApiProxySelectionConfigDto,
  AccountPoolHealthRow,
  RouteComboDto,
  RouteComboInputDto,
  RoutingWindowDto,
} from '@shared/api-types'
import { bridge } from '../services/bridge'

interface ApiProxyState {
  status: ApiProxyStatus
  loading: boolean
  error: string | null
  keys: ApiProxyKeyMeta[]
  newPlaintext: string | null
  poolHealth: AccountPoolHealthRow[]
  /** 已入池账号 id（供账号管理页显示入池开关状态）。 */
  pooledIds: string[]
  /** 反代池全局选号配置（轮询策略/亲密度/并发）；未拉取前为 null。 */
  selectionConfig: ApiProxySelectionConfigDto | null
  combos: RouteComboDto[]
  routableModels: string[]

  fetchStatus: () => Promise<void>
  start: () => Promise<void>
  stop: () => Promise<void>
  fetchKeys: () => Promise<void>
  createKey: (name: string) => Promise<void>
  setKeyActive: (id: string, isActive: boolean) => Promise<void>
  deleteKey: (id: string) => Promise<void>
  clearNewPlaintext: () => void
  fetchPoolHealth: (window?: RoutingWindowDto) => Promise<void>
  fetchPooledIds: () => Promise<void>
  setPooled: (accountId: string, pooled: boolean) => Promise<void>
  /** 设置账号选号优先级（乐观更新本地行；失败回滚）。 */
  setPriority: (accountId: string, priority: number) => Promise<void>
  /** 设置账号并发上限（乐观更新本地行；失败回滚）。 */
  setConcurrency: (accountId: string, concurrency: number) => Promise<void>
  /** 拉取反代池全局选号配置。 */
  fetchSelectionConfig: () => Promise<void>
  /** 保存反代池全局选号配置（成功返回 true，供 UI 关闭弹窗）。 */
  saveSelectionConfig: (config: ApiProxySelectionConfigDto) => Promise<boolean>
  clearSuspension: (accountId: string) => Promise<void>
  fetchCombos: () => Promise<void>
  fetchRoutableModels: () => Promise<void>
  createCombo: (input: RouteComboInputDto) => Promise<boolean>
  updateCombo: (id: string, patch: Partial<RouteComboInputDto>) => Promise<boolean>
  deleteCombo: (id: string) => Promise<void>
}

export const useApiProxyStore = create<ApiProxyState>((set, get) => ({
  status: { state: 'stopped' },
  loading: false,
  error: null,
  keys: [],
  newPlaintext: null,
  poolHealth: [],
  pooledIds: [],
  selectionConfig: null,
  combos: [],
  routableModels: [],

  fetchStatus: async () => {
    try {
      const status = await bridge().apiProxy.getStatus()
      set({ status, error: null })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  start: async () => {
    set({ loading: true, error: null })
    try {
      const status = await bridge().apiProxy.start()
      set({ status, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  stop: async () => {
    set({ loading: true, error: null })
    try {
      const status = await bridge().apiProxy.stop()
      set({ status, loading: false })
    } catch (e) {
      set({ error: String(e), loading: false })
    }
  },

  fetchKeys: async () => {
    try {
      set({ keys: await bridge().apiProxy.listClientKeys() })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  createKey: async (name: string) => {
    try {
      const { plaintext } = await bridge().apiProxy.createClientKey(name)
      set({ newPlaintext: plaintext })
      await get().fetchKeys()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  setKeyActive: async (id: string, isActive: boolean) => {
    try {
      await bridge().apiProxy.setClientKeyActive(id, isActive)
      await get().fetchKeys()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  deleteKey: async (id: string) => {
    try {
      await bridge().apiProxy.deleteClientKey(id)
      await get().fetchKeys()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  clearNewPlaintext: () => set({ newPlaintext: null }),

  fetchPoolHealth: async (window?: RoutingWindowDto) => {
    try {
      set({ poolHealth: await bridge().apiProxy.getAccountPoolHealth(window) })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  fetchPooledIds: async () => {
    try {
      set({ pooledIds: await bridge().apiProxy.getPooledAccountIds() })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  setPooled: async (accountId: string, pooled: boolean) => {
    // 乐观更新：立即翻转本地 pooled（poolHealth 行 + pooledIds 集合），失败时回滚并报错。
    const prevHealth = get().poolHealth
    const prevIds = get().pooledIds
    const nextIds = pooled
      ? [...new Set([...prevIds, accountId])]
      : prevIds.filter((id) => id !== accountId)
    set({
      poolHealth: prevHealth.map((r) => (r.accountId === accountId ? { ...r, pooled } : r)),
      pooledIds: nextIds,
    })
    try {
      await bridge().apiProxy.setAccountPooled(accountId, pooled)
    } catch (e) {
      set({ poolHealth: prevHealth, pooledIds: prevIds, error: String(e) })
    }
  },

  setPriority: async (accountId: string, priority: number) => {
    const next = Math.max(0, Math.trunc(priority) || 0)
    const prevHealth = get().poolHealth
    set({
      poolHealth: prevHealth.map((r) =>
        r.accountId === accountId ? { ...r, priority: next } : r,
      ),
    })
    try {
      await bridge().apiProxy.setAccountPriority(accountId, next)
    } catch (e) {
      set({ poolHealth: prevHealth, error: String(e) })
    }
  },

  setConcurrency: async (accountId: string, concurrency: number) => {
    const next = Math.max(1, Math.trunc(concurrency) || 1)
    const prevHealth = get().poolHealth
    set({
      poolHealth: prevHealth.map((r) =>
        r.accountId === accountId ? { ...r, concurrency: next } : r,
      ),
    })
    try {
      await bridge().apiProxy.setAccountConcurrency(accountId, next)
    } catch (e) {
      set({ poolHealth: prevHealth, error: String(e) })
    }
  },

  fetchSelectionConfig: async () => {
    try {
      set({ selectionConfig: await bridge().apiProxy.getSelectionConfig() })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  saveSelectionConfig: async (config: ApiProxySelectionConfigDto) => {
    try {
      await bridge().apiProxy.setSelectionConfig(config)
      set({ selectionConfig: config })
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    }
  },

  clearSuspension: async (accountId: string) => {
    try {
      await bridge().apiProxy.clearAccountSuspension(accountId)
      await get().fetchPoolHealth()
    } catch (e) {
      set({ error: String(e) })
    }
  },

  fetchCombos: async () => {
    try {
      set({ combos: await bridge().apiProxy.listCombos() })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  fetchRoutableModels: async () => {
    try {
      set({ routableModels: await bridge().apiProxy.listRoutableModels() })
    } catch (e) {
      set({ error: String(e) })
    }
  },

  // create/update 返回成功与否，供 UI 决定是否关闭编辑器（失败保留表单 + 弹错）。
  createCombo: async (input: RouteComboInputDto) => {
    try {
      await bridge().apiProxy.createCombo(input)
      await get().fetchCombos()
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    }
  },

  updateCombo: async (id: string, patch: Partial<RouteComboInputDto>) => {
    try {
      await bridge().apiProxy.updateCombo(id, patch)
      await get().fetchCombos()
      return true
    } catch (e) {
      set({ error: String(e) })
      return false
    }
  },

  deleteCombo: async (id: string) => {
    try {
      await bridge().apiProxy.deleteCombo(id)
      await get().fetchCombos()
    } catch (e) {
      set({ error: String(e) })
    }
  },
}))
