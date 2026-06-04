import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  probeTools: vi.fn(),
  listSessions: vi.fn(),
  deleteSessions: vi.fn(),
}))
vi.mock('@/services/tauri', () => ({
  sessionsService: {
    probeTools: mocks.probeTools,
    listSessions: mocks.listSessions,
    getMessages: vi.fn(),
    deleteSession: vi.fn(),
    deleteSessions: mocks.deleteSessions,
    resume: vi.fn(),
  },
}))

import { useSessionsStore } from '../../../src/renderer/stores/sessionsStore'

beforeEach(() => {
  vi.clearAllMocks()
  useSessionsStore.setState({
    probes: [], activeTool: 'claude', byTool: {}, selectedId: null, messages: [], loading: false, error: null,
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

it('deleteSelected 删掉当前选中项后 selectedId 清空', async () => {
  mocks.probeTools.mockResolvedValue([{ tool: 'claude', hasSessions: true, lastActiveAt: 1 }])
  mocks.listSessions.mockResolvedValue({
    items: [{ tool: 'claude', sessionId: 'a', sourcePath: '/a' }],
    total: 1, offset: 0,
  })
  mocks.deleteSessions.mockResolvedValue([{ sourcePath: '/a', ok: true }])
  await useSessionsStore.getState().init()
  useSessionsStore.setState({ selectedId: 'a' } as never)
  await useSessionsStore.getState().deleteSelected([{ tool: 'claude', sessionId: 'a', sourcePath: '/a' } as never])
  expect(useSessionsStore.getState().selectedId).toBeNull()
})
