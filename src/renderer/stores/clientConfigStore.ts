import { create } from 'zustand'
import { bridge } from '../services/bridge'
import type {
  ClientConfigClientId,
  ClientConfigClientInfo,
  ClientConfigProfileDto,
  ClientConfigDiffFile,
  ClientConfigSnapshotDto,
  CreateClientConfigProfileDto,
  UpdateClientConfigProfileDto,
  ClientConfigConnTest,
} from '@shared/api-types'

interface ClientConfigState {
  clients: ClientConfigClientInfo[]
  activeClient: ClientConfigClientId
  profiles: ClientConfigProfileDto[]
  loading: boolean
  error: string | null

  /** 首次加载：拉客户端列表 + 当前客户端的接入档。 */
  init: () => Promise<void>
  /** 切换正在查看的客户端 tab。 */
  selectClient: (clientId: ClientConfigClientId) => Promise<void>
  /** 重新拉取当前客户端的接入档。 */
  refresh: () => Promise<void>
  create: (input: CreateClientConfigProfileDto) => Promise<void>
  update: (id: string, patch: UpdateClientConfigProfileDto) => Promise<void>
  remove: (id: string) => Promise<void>
  /** 应用并设为当前生效。 */
  apply: (id: string) => Promise<void>
  /** 从客户端配置还原。 */
  clear: (id: string) => Promise<void>
  preview: (id: string) => Promise<ClientConfigDiffFile[]>
  history: () => Promise<ClientConfigSnapshotDto[]>
  rollback: (entryId: string) => Promise<void>
  /** 一键接入本机反代（当前客户端）。 */
  connectLocalProxy: () => Promise<void>
  /** 测连通。 */
  testConnectivity: (id: string) => Promise<ClientConfigConnTest | undefined>
}

async function run<T>(set: (p: Partial<ClientConfigState>) => void, fn: () => Promise<T>): Promise<T | undefined> {
  set({ loading: true, error: null })
  try {
    const r = await fn()
    set({ loading: false })
    return r
  } catch (e) {
    set({ loading: false, error: e instanceof Error ? e.message : String(e) })
    return undefined
  }
}

export const useClientConfigStore = create<ClientConfigState>((set, get) => ({
  clients: [],
  activeClient: 'claude',
  profiles: [],
  loading: false,
  error: null,

  init: async () => {
    await run(set, async () => {
      const clients = await bridge().clientConfig.clients()
      set({ clients })
      const active = get().activeClient
      const profiles = await bridge().clientConfig.list(active)
      set({ profiles })
    })
  },

  selectClient: async (clientId) => {
    set({ activeClient: clientId })
    await get().refresh()
  },

  refresh: async () => {
    await run(set, async () => {
      const profiles = await bridge().clientConfig.list(get().activeClient)
      set({ profiles })
    })
  },

  create: async (input) => {
    await run(set, () => bridge().clientConfig.create(input))
    await get().refresh()
  },
  update: async (id, patch) => {
    await run(set, () => bridge().clientConfig.update(id, patch))
    await get().refresh()
  },
  remove: async (id) => {
    await run(set, () => bridge().clientConfig.delete(id))
    await get().refresh()
  },
  apply: async (id) => {
    await run(set, () => bridge().clientConfig.apply(id))
    await get().refresh()
  },
  clear: async (id) => {
    await run(set, () => bridge().clientConfig.clear(id))
    await get().refresh()
  },

  preview: async (id) => (await run(set, () => bridge().clientConfig.preview(id))) ?? [],
  history: async () => (await run(set, () => bridge().clientConfig.history(get().activeClient))) ?? [],
  rollback: async (entryId) => {
    await run(set, () => bridge().clientConfig.rollback(get().activeClient, entryId))
    await get().refresh()
  },
  connectLocalProxy: async () => {
    await run(set, () => bridge().clientConfig.connectLocalProxy(get().activeClient))
    await get().refresh()
  },
  testConnectivity: async (id) => run(set, () => bridge().clientConfig.testConnectivity(id)),
}))
