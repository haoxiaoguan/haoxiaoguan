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
  /** 每个客户端的接入档数量（左侧列表 badge）。 */
  counts: Record<string, number>
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
  /** 应用并设为当前生效（切换式）。 */
  apply: (id: string) => Promise<void>
  /** 从客户端配置还原。 */
  clear: (id: string) => Promise<void>
  /** 累加式:启用注入（共存）。 */
  enable: (id: string) => Promise<void>
  /** 累加式:停用注入。 */
  disable: (id: string) => Promise<void>
  /** 累加式:设默认指针。 */
  setDefault: (id: string) => Promise<void>
  preview: (id: string) => Promise<ClientConfigDiffFile[]>
  history: () => Promise<ClientConfigSnapshotDto[]>
  rollback: (entryId: string) => Promise<void>
  /** 一键接入本机反代（当前客户端）。 */
  connectLocalProxy: () => Promise<void>
  /** 测连通。 */
  testConnectivity: (id: string) => Promise<ClientConfigConnTest | undefined>
  /** Codex L2「中转注入」开关（开→注入单反代 provider+catalog；关→清除）。 */
  setCodexRelayInjection: (enabled: boolean) => Promise<void>
  /** Codex L2 下切换第三方供应商启用态（标记+重聚合，不走 L1 注入）。 */
  setCodexProviderEnabled: (id: string, enabled: boolean) => Promise<void>
}

function countByClient(all: ClientConfigProfileDto[]): Record<string, number> {
  const out: Record<string, number> = {}
  for (const p of all) out[p.clientId] = (out[p.clientId] ?? 0) + 1
  return out
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
  counts: {},
  loading: false,
  error: null,

  init: async () => {
    await run(set, async () => {
      const clients = await bridge().clientConfig.clients()
      set({ clients })
      const active = get().activeClient
      const [profiles, all] = await Promise.all([
        bridge().clientConfig.list(active),
        bridge().clientConfig.list(),
      ])
      set({ profiles, counts: countByClient(all) })
    })
  },

  selectClient: async (clientId) => {
    set({ activeClient: clientId })
    await get().refresh()
  },

  refresh: async () => {
    await run(set, async () => {
      const [profiles, all] = await Promise.all([
        bridge().clientConfig.list(get().activeClient),
        bridge().clientConfig.list(),
      ])
      set({ profiles, counts: countByClient(all) })
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
  enable: async (id) => {
    await run(set, () => bridge().clientConfig.enable(id))
    await get().refresh()
  },
  disable: async (id) => {
    await run(set, () => bridge().clientConfig.disable(id))
    await get().refresh()
  },
  setDefault: async (id) => {
    await run(set, () => bridge().clientConfig.setDefault(get().activeClient, id))
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
  setCodexRelayInjection: async (enabled) => {
    await run(set, () => bridge().clientConfig.setCodexRelayInjection(enabled))
    await get().refresh()
  },
  setCodexProviderEnabled: async (id, enabled) => {
    await run(set, () => bridge().clientConfig.setCodexProviderEnabled(id, enabled))
    await get().refresh()
  },
}))
