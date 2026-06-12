import { create } from 'zustand'
import { bridge } from '../services/bridge'
import type {
  ClientConfigClientId,
  ClientConfigClientInfo,
  ClientConfigVersionInfo,
  ClientConfigInstallReport,
  ClientConfigProfileDto,
  ClientConfigDiffFile,
  ClientConfigSnapshotDto,
  CreateClientConfigProfileDto,
  UpdateClientConfigProfileDto,
  ClientConfigConnTest,
} from '@shared/api-types'
import { indexVersions } from '../components/clientConfig/clientStatus'

interface ClientConfigState {
  clients: ClientConfigClientInfo[]
  activeClient: ClientConfigClientId
  profiles: ClientConfigProfileDto[]
  /** 每个客户端的接入档数量（左侧列表 badge）。 */
  counts: Record<string, number>
  /** 各客户端版本/可升级信息（按 clientId 索引；异步补，不阻塞列表）。 */
  versions: Record<string, ClientConfigVersionInfo>
  /** 版本探测是否进行中（驱动「检测中」loading 占位，避免先显示错状态再跳变）。 */
  versionsLoading: boolean
  /** 正在升级中的 clientId（驱动按钮 spinner）；null=无。 */
  upgradingClient: string | null
  /** 多处安装冲突诊断结果（按 clientId 索引；空=未诊断）。 */
  reports: Record<string, ClientConfigInstallReport>
  /** 是否正在诊断。 */
  diagnosing: boolean
  loading: boolean
  error: string | null

  /** 首次加载：拉客户端列表 + 当前客户端的接入档。 */
  init: () => Promise<void>
  /** 异步拉取版本/可升级信息（慢，独立于列表；失败静默）。 */
  loadVersions: () => Promise<void>
  /** 一键升级某客户端（后台静默跑）；返回 {ok, detail} 供页面 toast。 */
  upgrade: (clientId: ClientConfigClientId) => Promise<{ ok: boolean; detail?: string }>
  /** 一键安装某客户端（未安装时，后台静默跑）；返回 {ok, detail} 供页面 toast。 */
  install: (clientId: ClientConfigClientId) => Promise<{ ok: boolean; detail?: string }>
  /** 批量升级所有可升级客户端（串行，避免并发全局安装互相覆盖）；返回 {done, failed}。 */
  batchUpgrade: () => Promise<{ done: number; failed: number }>
  /** 诊断全部客户端的多处安装冲突。 */
  diagnose: () => Promise<void>
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
  versions: {},
  versionsLoading: false,
  upgradingClient: null,
  reports: {},
  diagnosing: false,
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
    // 版本/可升级慢探测：不阻塞列表渲染，拿到后再补上徽章。
    void get().loadVersions()
  },

  loadVersions: async () => {
    set({ versionsLoading: true })
    try {
      const list = await bridge().clientConfig.versions()
      set({ versions: indexVersions(list) })
    } catch {
      // 离线/探测失败：保持「已安装/未安装」，不报错打扰。
    } finally {
      set({ versionsLoading: false })
    }
  },

  upgrade: async (clientId) => {
    set({ upgradingClient: clientId })
    try {
      const r = await bridge().clientConfig.upgrade(clientId)
      set({ versions: { ...get().versions, [clientId]: r.version }, upgradingClient: null })
      return { ok: r.ok, detail: r.detail }
    } catch (e) {
      set({ upgradingClient: null })
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  },

  install: async (clientId) => {
    set({ upgradingClient: clientId })
    try {
      const r = await bridge().clientConfig.install(clientId)
      set({ versions: { ...get().versions, [clientId]: r.version }, upgradingClient: null })
      return { ok: r.ok, detail: r.detail }
    } catch (e) {
      set({ upgradingClient: null })
      return { ok: false, detail: e instanceof Error ? e.message : String(e) }
    }
  },

  batchUpgrade: async () => {
    const targets = get()
      .clients.map((c) => c.clientId)
      .filter((id) => get().versions[id]?.upgradable === true)
    let done = 0
    let failed = 0
    // 串行：并发跑多个 `npm i -g` 可能互相覆盖/抢锁。upgrade 内部会更新单个 upgradingClient 态。
    for (const id of targets) {
      const r = await get().upgrade(id)
      if (r.ok) done += 1
      else failed += 1
    }
    return { done, failed }
  },

  diagnose: async () => {
    set({ diagnosing: true })
    try {
      const list = await bridge().clientConfig.diagnose()
      const map: Record<string, ClientConfigInstallReport> = {}
      for (const r of list) map[r.clientId] = r
      set({ reports: map, diagnosing: false })
    } catch {
      set({ diagnosing: false })
    }
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
