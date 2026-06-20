import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync } from 'node:fs'
import { initDatabase, getEm, closeDatabase } from '../../../../src/main/platform/persistence/database'
import { seedModelPricing } from '../../../../src/main/contexts/analytics/infrastructure/pricing-seed'
import { ModelPricingEntity } from '../../../../src/main/contexts/analytics/infrastructure/model-pricing.entity'
import { PricingConfigEntity } from '../../../../src/main/contexts/analytics/infrastructure/pricing-config.entity'

afterEach(async () => {
  await closeDatabase()
})

describe('model_pricing + pricing_config 实体与 seed', () => {
  it('建表后 seed 147 条定价数据', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-pricing-'))
    const dbFile = join(dir, 'test.db')
    await initDatabase({ dbName: dbFile, createSchemaOnInit: true })
    const em = getEm()

    const inserted = await seedModelPricing(em)
    expect(inserted).toBe(147)

    const count = await em.count(ModelPricingEntity, {})
    expect(count).toBe(147)
  })

  it('seed 幂等：重复执行不重复插入', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-pricing-idem-'))
    const dbFile = join(dir, 'test.db')
    await initDatabase({ dbName: dbFile, createSchemaOnInit: true })
    const em = getEm()

    await seedModelPricing(em)
    const secondRun = await seedModelPricing(em)
    expect(secondRun).toBe(0)

    const count = await em.count(ModelPricingEntity, {})
    expect(count).toBe(147)
  })

  it('pricing_config 表可读写默认值', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-pconfig-'))
    const dbFile = join(dir, 'test.db')
    await initDatabase({ dbName: dbFile, createSchemaOnInit: true })
    const em = getEm()

    em.persist(
      em.create(PricingConfigEntity, {
        agentId: 'claude',
        costMultiplier: 1.5,
        pricingModelSource: 'response',
      }),
    )
    await em.flush()

    const row = await em.findOne(PricingConfigEntity, { agentId: 'claude' })
    expect(row).not.toBeNull()
    expect(row!.costMultiplier).toBe(1.5)
    expect(row!.pricingModelSource).toBe('response')
  })

  it('定价数据字段完整', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'hxg-pricing-fields-'))
    const dbFile = join(dir, 'test.db')
    await initDatabase({ dbName: dbFile, createSchemaOnInit: true })
    const em = getEm()

    await seedModelPricing(em)
    const first = await em.findOne(ModelPricingEntity, { modelId: 'claude-3-5-haiku-20241022' })
    expect(first).not.toBeNull()
    expect(first!.inputCostPerMillion).toBe(0.8)
    expect(first!.outputCostPerMillion).toBe(4.0)
    expect(first!.cacheReadCostPerMillion).toBe(0.08)
    expect(first!.cacheCreationCostPerMillion).toBe(1.0)
    expect(first!.displayName).toBe('claude-3-5-haiku-20241022')
  })
})
