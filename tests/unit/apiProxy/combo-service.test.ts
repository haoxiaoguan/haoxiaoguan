import { describe, it, expect, beforeEach } from 'vitest'
import { ComboService } from '../../../src/main/contexts/apiProxy/application/combo-service'
import type {
  RouteComboRepository,
  RouteComboInput,
} from '../../../src/main/contexts/apiProxy/infrastructure/route-combo.repository'
import type { RouteCombo } from '../../../src/main/contexts/apiProxy/domain/route-combo'

// 内存假仓储（不碰 DB）：覆盖 ComboService 用到的 list/create/update/delete。
class FakeRepo {
  private rows: RouteCombo[] = []
  private seq = 0
  async list(): Promise<RouteCombo[]> {
    return this.rows.map((r) => ({ ...r, steps: r.steps.map((s) => ({ ...s })) }))
  }
  async create(input: RouteComboInput): Promise<RouteCombo> {
    const row: RouteCombo = {
      id: `id-${++this.seq}`,
      name: input.name,
      ...(input.description !== undefined ? { description: input.description } : {}),
      steps: input.steps,
      strategy: input.strategy ?? 'fallback',
      enabled: input.enabled ?? true,
    }
    this.rows.push(row)
    return row
  }
  async update(id: string, patch: Partial<RouteComboInput>): Promise<RouteCombo | null> {
    const row = this.rows.find((r) => r.id === id)
    if (!row) return null
    if (patch.name !== undefined) row.name = patch.name
    if (patch.steps !== undefined) row.steps = patch.steps
    if (patch.enabled !== undefined) row.enabled = patch.enabled
    return row
  }
  async delete(id: string): Promise<void> {
    this.rows = this.rows.filter((r) => r.id !== id)
  }
}

function makeService(): { svc: ComboService; repo: FakeRepo } {
  const repo = new FakeRepo()
  const svc = new ComboService(repo as unknown as RouteComboRepository)
  return { svc, repo }
}

const STEPS = [{ model: 'kr/claude-sonnet-4.5' }, { model: 'relay-1/deepseek-chat' }]

describe('ComboService 校验', () => {
  let svc: ComboService
  beforeEach(async () => {
    ;({ svc } = makeService())
    await svc.load()
  })

  it('创建合法组合 → 进缓存、可按名查', async () => {
    await svc.create({ name: 'my-combo', steps: STEPS })
    expect(svc.findByName('my-combo')?.steps).toHaveLength(2)
    expect(svc.list().map((c) => c.name)).toEqual(['my-combo'])
  })

  it('拒绝非法名（含斜杠）', async () => {
    await expect(svc.create({ name: 'kr/x', steps: STEPS })).rejects.toThrow(/非法/)
  })

  it('允许与上游模型同名（组合优先级最高、运行时盖过上游，9router 式）', async () => {
    await expect(svc.create({ name: 'gpt-5.5', steps: STEPS })).resolves.toBeTruthy()
    expect(svc.findByName('gpt-5.5')?.steps).toHaveLength(2)
  })

  it('拒绝重复组合名', async () => {
    await svc.create({ name: 'dup', steps: STEPS })
    await expect(svc.create({ name: 'dup', steps: STEPS })).rejects.toThrow(/已存在/)
  })

  it('拒绝空步骤', async () => {
    await expect(svc.create({ name: 'empty', steps: [] })).rejects.toThrow(/至少需要一个步骤/)
  })

  it('拒绝步骤 model 为空', async () => {
    await expect(svc.create({ name: 'blank', steps: [{ model: '  ' }] })).rejects.toThrow(/不能为空/)
  })

  it('更新自身保持原名不报「已存在」（excludeId 生效）', async () => {
    const c = await svc.create({ name: 'keep', steps: STEPS })
    await expect(svc.update(c.id, { name: 'keep', steps: STEPS })).resolves.toBeTruthy()
  })

  it('更新撞另一组合名 → 报「已存在」', async () => {
    await svc.create({ name: 'a', steps: STEPS })
    const b = await svc.create({ name: 'b', steps: STEPS })
    await expect(svc.update(b.id, { name: 'a' })).rejects.toThrow(/已存在/)
  })

  it('删除后从缓存消失', async () => {
    const c = await svc.create({ name: 'gone', steps: STEPS })
    await svc.remove(c.id)
    expect(svc.findByName('gone')).toBeUndefined()
  })
})
