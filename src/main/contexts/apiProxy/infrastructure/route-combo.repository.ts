import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import type { RouteCombo, ComboStep, ComboStrategy } from '../domain/route-combo'
import { RouteComboEntity } from './route-combo.entity'

/** 入库前的组合数据（id/时间戳由仓储生成）。 */
export interface RouteComboInput {
  name: string
  description?: string
  steps: ComboStep[]
  strategy?: ComboStrategy
  enabled?: boolean
}

function parseSteps(stepsJson: string): ComboStep[] {
  try {
    const parsed = JSON.parse(stepsJson)
    if (!Array.isArray(parsed)) return []
    return parsed
      .filter((s): s is { model: unknown; enabled?: unknown } => s != null && typeof s === 'object')
      .filter((s) => typeof s.model === 'string' && (s.model as string).length > 0)
      .map((s) => ({
        model: s.model as string,
        ...(typeof s.enabled === 'boolean' ? { enabled: s.enabled } : {}),
      }))
  } catch {
    return []
  }
}

function toDomain(e: RouteComboEntity): RouteCombo {
  return {
    id: e.id,
    name: e.name,
    ...(e.description != null ? { description: e.description } : {}),
    steps: parseSteps(e.stepsJson),
    strategy: (e.strategy === 'fallback' ? 'fallback' : 'fallback') as ComboStrategy,
    enabled: e.enabled,
  }
}

/** 路由组合持久化（route_combos 表）。无加密（组合非敏感，只是模型名链）。 */
export class RouteComboRepository {
  constructor(private readonly emFactory: () => EntityManager = getEm) {}

  async list(): Promise<RouteCombo[]> {
    const em = this.emFactory()
    const rows = await em.find(RouteComboEntity, {}, { orderBy: { createdAt: 'asc' } })
    return rows.map(toDomain)
  }

  async findByName(name: string): Promise<RouteCombo | null> {
    const em = this.emFactory()
    const e = await em.findOne(RouteComboEntity, { name })
    return e === null ? null : toDomain(e)
  }

  async create(input: RouteComboInput): Promise<RouteCombo> {
    const em = this.emFactory()
    const now = new Date().toISOString()
    const e = new RouteComboEntity()
    e.id = randomUUID()
    e.name = input.name
    e.description = input.description ?? null
    e.stepsJson = JSON.stringify(input.steps)
    e.strategy = input.strategy ?? 'fallback'
    e.enabled = input.enabled ?? true
    e.createdAt = now
    e.updatedAt = now
    em.persist(e)
    await em.flush()
    return toDomain(e)
  }

  async update(id: string, patch: Partial<RouteComboInput>): Promise<RouteCombo | null> {
    const em = this.emFactory()
    const e = await em.findOne(RouteComboEntity, { id })
    if (e === null) return null
    if (patch.name !== undefined) e.name = patch.name
    if (patch.description !== undefined) e.description = patch.description ?? null
    if (patch.steps !== undefined) e.stepsJson = JSON.stringify(patch.steps)
    if (patch.strategy !== undefined) e.strategy = patch.strategy
    if (patch.enabled !== undefined) e.enabled = patch.enabled
    e.updatedAt = new Date().toISOString()
    await em.flush()
    return toDomain(e)
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory()
    await em.nativeDelete(RouteComboEntity, { id })
  }
}
