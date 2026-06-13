import type { RouteCombo } from '../domain/route-combo'
import { isValidComboName, COMBO_NAME_MAX } from '../domain/route-combo'
import type { RouteComboRepository, RouteComboInput } from '../infrastructure/route-combo.repository'

/**
 * ApiProxyService 读取组合的只读端口（同步、读内存缓存）：
 * 运行时路由（按组合名命中）+ /v1/models 注入。热路径不碰 DB。
 */
export interface ComboSource {
  findByName(name: string): RouteCombo | undefined
  list(): RouteCombo[]
}

/**
 * 路由组合应用服务：CRUD + 校验（名字合法/不与现有模型或组合同名/步骤非空），
 * 并维护一份内存缓存作为 ComboSource（写后 reload）。renderer 经 IPC 调 CRUD，
 * ApiProxyService 经 ComboSource 同步读。
 */
export class ComboService implements ComboSource {
  private cache: RouteCombo[] = []
  private byName: Map<string, RouteCombo> = new Map()

  constructor(private readonly repo: RouteComboRepository) {}

  /** 启动载入缓存（container 装配后调一次）。 */
  async load(): Promise<void> {
    this.cache = await this.repo.list()
    this.byName = new Map(this.cache.map((c) => [c.name, c]))
  }

  // ── ComboSource（同步读缓存）────────────────────────────────────────────────
  findByName(name: string): RouteCombo | undefined {
    return this.byName.get(name)
  }
  list(): RouteCombo[] {
    return this.cache
  }

  // ── CRUD（renderer 经 IPC）──────────────────────────────────────────────────
  async listAll(): Promise<RouteCombo[]> {
    return this.cache
  }

  async create(input: RouteComboInput): Promise<RouteCombo> {
    this.validate(input.name, input.steps)
    const created = await this.repo.create(this.normalize(input))
    await this.load()
    return created
  }

  async update(id: string, patch: Partial<RouteComboInput>): Promise<RouteCombo> {
    if (patch.name !== undefined || patch.steps !== undefined) {
      const existing = this.cache.find((c) => c.id === id)
      this.validate(
        patch.name ?? existing?.name ?? '',
        patch.steps ?? existing?.steps ?? [],
        id,
      )
    }
    // 部分规范化：只规整提供的字段（不能整体 normalize，否则缺 name 的 patch 会对 undefined.trim 崩）。
    const normalized: Partial<RouteComboInput> = {
      ...(patch.name !== undefined ? { name: patch.name.trim() } : {}),
      ...(patch.description !== undefined ? { description: patch.description } : {}),
      ...(patch.steps !== undefined
        ? {
            steps: patch.steps.map((s) => ({
              model: s.model.trim(),
              ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
            })),
          }
        : {}),
      ...(patch.strategy !== undefined ? { strategy: patch.strategy } : {}),
      ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
    }
    const updated = await this.repo.update(id, normalized)
    if (updated === null) throw new Error(`组合不存在: ${id}`)
    await this.load()
    return updated
  }

  async remove(id: string): Promise<void> {
    await this.repo.delete(id)
    await this.load()
  }

  // ── 校验 ─────────────────────────────────────────────────────────────────────
  private validate(name: string, steps: RouteComboInput['steps'], excludeId?: string): void {
    if (!isValidComboName(name)) {
      throw new Error(`组合名非法（需 1-${COMBO_NAME_MAX} 位，仅字母数字与 _.-，且不含 /）`)
    }
    // 仅禁止组合之间重名；允许与上游模型同名——组合优先级最高、运行时盖过上游模型（9router 式）。
    // 被盖的上游模型仍可用别名前缀显式访问（如 cx/gpt-5.5），不会真正丢失。
    const dupCombo = this.byName.get(name)
    if (dupCombo !== undefined && dupCombo.id !== excludeId) {
      throw new Error(`组合名已存在: ${name}`)
    }
    if (!Array.isArray(steps) || steps.length === 0) {
      throw new Error('组合至少需要一个步骤')
    }
    for (const s of steps) {
      if (typeof s.model !== 'string' || s.model.trim().length === 0) {
        throw new Error('组合步骤的 model 不能为空')
      }
    }
  }

  private normalize(input: RouteComboInput): RouteComboInput {
    return {
      name: input.name.trim(),
      ...(input.description !== undefined ? { description: input.description } : {}),
      steps: input.steps.map((s) => ({
        model: s.model.trim(),
        ...(s.enabled !== undefined ? { enabled: s.enabled } : {}),
      })),
      ...(input.strategy !== undefined ? { strategy: input.strategy } : {}),
      ...(input.enabled !== undefined ? { enabled: input.enabled } : {}),
    }
  }
}
