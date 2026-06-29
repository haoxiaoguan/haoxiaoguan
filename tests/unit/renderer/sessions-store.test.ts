import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  probeTools: vi.fn(),
  listSessions: vi.fn(),
  deleteSessions: vi.fn(),
  clients: vi.fn(),
}))
vi.mock('@/services/tauri', () => ({
  sessionsService: {
    probeTools: mocks.probeTools,
    listSessions: mocks.listSessions,
    getMessages: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: mocks.deleteSessions,
    resume: vi.fn(),
    repairPreview: vi.fn(),
    repair: vi.fn(),
    repairRollback: vi.fn(),
  },
}))
vi.mock('@/services/bridge', () => ({
  bridge: () => ({
    clientConfig: {
      clients: mocks.clients,
    },
  }),
}))

import { useSessionsStore } from '../../../src/renderer/stores/sessionsStore'

beforeEach(() => {
  vi.clearAllMocks()
  // Default: clients() returns empty list so init doesn't throw
  mocks.clients.mockResolvedValue([])
  useSessionsStore.setState({
    initialized: false, probes: [], activeTool: 'claude', byTool: {}, selectedPath: null, messages: [], loading: false, error: null, clients: [], activeClient: 'claude',
  } as never)
})

describe('sessionsStore.init', () => {
  it('probe 后默认选中 lastActiveAt 最新的工具并加载它', async () => {
    mocks.probeTools.mockResolvedValue([
      { tool: 'claude', hasSessions: true, lastActiveAt: 100 },
      { tool: 'codex', hasSessions: true, lastActiveAt: 999 },
      { tool: 'gemini', hasSessions: false },
    ])
    mocks.listSessions.mockResolvedValue({ items: [{ tool: 'codex', sessionId: 's', sourcePath: '/p' }], total: 1, offset: 0 })
    await useSessionsStore.getState().init()
    expect(useSessionsStore.getState().activeTool).toBe('codex')
    expect(mocks.listSessions).toHaveBeenCalledWith('codex', expect.any(Number), 0)
    expect(useSessionsStore.getState().byTool.codex?.items.length).toBe(1)
  })

  it('selectTool 命中缓存不重复加载', async () => {
    mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 1 }])
    mocks.listSessions.mockResolvedValue({ items: [], total: 0, offset: 0 })
    await useSessionsStore.getState().init()
    mocks.listSessions.mockClear()
    await useSessionsStore.getState().selectTool('claude')
    expect(mocks.listSessions).not.toHaveBeenCalled()
  })

  it('init 幂等：已初始化后再调不重新 probe（反复进出页面不重扫）', async () => {
    mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 1 }])
    mocks.listSessions.mockResolvedValue({ items: [], total: 0, offset: 0 })
    await useSessionsStore.getState().init()
    expect(mocks.probeTools).toHaveBeenCalledTimes(1)
    mocks.probeTools.mockClear()
    await useSessionsStore.getState().init()
    expect(mocks.probeTools).not.toHaveBeenCalled()
  })
})

it('deleteSelected 批量删除后从当前工具缓存移除', async () => {
  mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 1 }])
  mocks.listSessions.mockResolvedValue({
    items: [
      { tool: 'claude', sessionId: 'a', sourcePath: '/a' },
      { tool: 'claude', sessionId: 'b', sourcePath: '/b' },
    ],
    total: 2,
    offset: 0,
  })
  mocks.deleteSessions.mockResolvedValue([
    { sourcePath: '/a', ok: true },
    { sourcePath: '/b', ok: false, error: 'x' },
  ])
  await useSessionsStore.getState().init()
  await useSessionsStore.getState().deleteSelected([
    { tool: 'claude', sessionId: 'a', sourcePath: '/a' } as never,
    { tool: 'claude', sessionId: 'b', sourcePath: '/b' } as never,
  ])
  // 只移除成功的 /a，失败的 /b 保留
  const items = useSessionsStore.getState().byTool.claude?.items ?? []
  expect(items.map((i) => i.sourcePath)).toEqual(['/b'])
})

it('deleteSelected 删掉当前选中项后 selectedPath 清空', async () => {
  mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 1 }])
  mocks.listSessions.mockResolvedValue({
    items: [{ tool: 'claude', sessionId: 'a', sourcePath: '/a' }],
    total: 1, offset: 0,
  })
  mocks.deleteSessions.mockResolvedValue([{ sourcePath: '/a', ok: true }])
  await useSessionsStore.getState().init()
  useSessionsStore.setState({ selectedPath: '/a' } as never)
  await useSessionsStore.getState().deleteSelected([{ tool: 'claude', sessionId: 'a', sourcePath: '/a' } as never])
  expect(useSessionsStore.getState().selectedPath).toBeNull()
})

it('selectSession 用 sourcePath 作选中键（sessionId 可能跨文件重复）', async () => {
  mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 1 }])
  // 两个文件共用同一 sessionId（续聊/fork），但 sourcePath 不同
  mocks.listSessions.mockResolvedValue({
    items: [
      { tool: 'claude', sessionId: 'dup', sourcePath: '/a' },
      { tool: 'claude', sessionId: 'dup', sourcePath: '/b' },
    ],
    total: 2, offset: 0,
  })
  await useSessionsStore.getState().init()
  await useSessionsStore.getState().selectSession({ tool: 'claude', sessionId: 'dup', sourcePath: '/b' } as never)
  // 选中键是 sourcePath（精确到被点的那个文件），不是 sessionId
  expect(useSessionsStore.getState().selectedPath).toBe('/b')
})

it('refresh 重载当前工具并更新 byTool 和 probes', async () => {
  // 先 init 设好初始状态
  mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 1 }])
  mocks.listSessions.mockResolvedValue({
    items: [{ tool: 'claude', sessionId: 'old', sourcePath: '/old' }],
    total: 1, offset: 0,
  })
  await useSessionsStore.getState().init()
  expect(useSessionsStore.getState().byTool.claude?.items[0].sessionId).toBe('old')

  // refresh：probeTools 返回新数量，listSessions 返回新 items
  mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 2 }])
  mocks.listSessions.mockResolvedValue({
    items: [{ tool: 'claude', sessionId: 'new1', sourcePath: '/new1' }, { tool: 'claude', sessionId: 'new2', sourcePath: '/new2' }],
    total: 2, offset: 0,
  })
  await useSessionsStore.getState().refresh()

  const state = useSessionsStore.getState()
  expect(state.loading).toBe(false)
  expect(state.byTool.claude?.items.map((i) => i.sessionId)).toEqual(['new1', 'new2'])
  expect(state.byTool.claude?.total).toBe(2)
  // probes 也被更新
  expect(state.probes[0].lastActiveAt).toBe(2)
  // selectedPath 被清空
  expect(state.selectedPath).toBeNull()
})

it('会话管理展示 Claude Desktop 客户端，选中后只加载 Desktop 会话源', async () => {
  mocks.clients.mockResolvedValue([
    { clientId: 'claude', displayName: 'Claude Code', detected: true, writeMode: 'switch' },
    { clientId: 'claude_desktop', displayName: 'Claude Desktop', detected: true, writeMode: 'switch' },
  ])
  mocks.probeTools.mockResolvedValue([{ tool: 'claude_desktop', hasSessions: true, lastActiveAt: 1 }])
  mocks.listSessions.mockResolvedValue({ items: [], total: 0, offset: 0 })

  await useSessionsStore.getState().init()

  expect(useSessionsStore.getState().clients.map((c) => c.clientId)).toEqual([
    'claude',
    'claude_desktop',
  ])

  await useSessionsStore.getState().selectClient('claude_desktop' as never)

  expect(useSessionsStore.getState().activeClient).toBe('claude_desktop')
  expect(useSessionsStore.getState().activeTool).toBe('claude_desktop')
  expect(mocks.listSessions).toHaveBeenCalledWith('claude_desktop', expect.any(Number), 0)
})
