import { describe, it, expect } from 'vitest'
import { makeKiroAccountPort } from '../../../src/main/container-helpers/kiro-account-port-factory'

// 内存 stub：模拟 accountRepo 的 findByPlatform/findById/save
function stubRepo(rows: any[]) {
  return {
    async findByPlatform() { return rows },
    async findById(id: string) { return rows.find((r) => r.id === id) ?? null },
    async save(acc: any) { const i = rows.findIndex((r) => r.id === acc.id); if (i >= 0) rows[i] = acc },
  }
}

describe('kiroAccountPort', () => {
  it('listByPlatform 映射字段', async () => {
    const repo = stubRepo([{ id: 'a', email: 'a@x', loginProvider: 'Builder ID', status: null, isActive: true, lastUsedAt: '2026-06-03T03:00:22Z', profilePayload: { region: 'us-east-1' } }])
    const port = makeKiroAccountPort(repo as any)
    const list = await port.listByPlatform()
    expect(list[0]).toMatchObject({ id: 'a', email: 'a@x', isActive: true })
    expect(typeof list[0].lastUsedAt).toBe('number') // RFC3339 → epoch ms
  })
  it('markSuspended 写回 status', async () => {
    const rows = [{ id: 'a', email: 'a@x', status: null, isActive: true }]
    const port = makeKiroAccountPort(stubRepo(rows) as any)
    await port.markSuspended('a', 'TEMPORARILY_SUSPENDED')
    expect(rows[0].status).toBe('SUSPENDED')
    expect(rows[0].statusReason).toBe('TEMPORARILY_SUSPENDED')
  })
  it('clearSuspension 清 status', async () => {
    const rows = [{ id: 'a', email: 'a@x', status: 'SUSPENDED', statusReason: 'x', isActive: true }]
    const port = makeKiroAccountPort(stubRepo(rows) as any)
    await port.clearSuspension('a')
    expect(rows[0].status).toBeNull()
  })
})
