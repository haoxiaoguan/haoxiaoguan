import { describe, it, expect, vi } from 'vitest'
import { SessionsService } from '../../../src/main/contexts/sessions/application/sessions-service'
import type { SessionSource } from '../../../src/main/contexts/sessions/domain/session-source'
import type { SessionMessage, SessionPage, SessionTool, ToolProbe } from '../../../src/main/contexts/sessions/domain/session'

function fakeSource(tool: SessionTool, over: Partial<SessionSource> = {}): SessionSource {
  return {
    tool,
    probe: async (): Promise<ToolProbe> => ({ tool, hasSessions: true, lastActiveAt: 1 }),
    scan: async (): Promise<SessionPage> => ({ items: [], total: 0, offset: 0 }),
    readMessages: async (): Promise<SessionMessage[]> => [],
    delete: vi.fn(async () => undefined),
    roots: () => ['/root/' + tool],
    ...over,
  }
}

describe('SessionsService', () => {
  it('probeTools 汇总所有工具', async () => {
    const svc = new SessionsService(
      [fakeSource('claude'), fakeSource('codex'), fakeSource('gemini')],
      () => '',
    )
    const probes = await svc.probeTools()
    expect(probes.map((p) => p.tool).sort()).toEqual(['claude', 'codex', 'gemini'])
  })

  it('listSessions 只调对应工具的 scan', async () => {
    const claudeScan = vi.fn(async () => ({ items: [], total: 3, offset: 0 }))
    const codexScan = vi.fn(async () => ({ items: [], total: 0, offset: 0 }))
    const svc = new SessionsService(
      [fakeSource('claude', { scan: claudeScan }), fakeSource('codex', { scan: codexScan })],
      () => '',
    )
    const page = await svc.listSessions('claude', { limit: 50, offset: 0 })
    expect(page.total).toBe(3)
    expect(claudeScan).toHaveBeenCalledOnce()
    expect(codexScan).not.toHaveBeenCalled()
  })

  it('deleteSession 越界则拒绝（不调 source.delete）', async () => {
    const del = vi.fn(async () => undefined)
    const svc = new SessionsService(
      [fakeSource('claude', { delete: del, roots: () => ['/allowed'] })],
      () => '',
    )
    await expect(svc.deleteSession('claude', '/etc/passwd', 'sid')).rejects.toThrow(/越界|not within/i)
    expect(del).not.toHaveBeenCalled()
  })

  it('未知工具抛错', async () => {
    const svc = new SessionsService([fakeSource('claude')], () => '')
    await expect(svc.getMessages('codex', '/x')).rejects.toThrow(/未知工具|unknown tool/i)
  })

  it('resume：模板为空抛错', async () => {
    const svc = new SessionsService([fakeSource('claude')], () => '')
    expect(() => svc.resume('claude --resume x', '/w')).toThrow(/未配置终端/)
  })
})
