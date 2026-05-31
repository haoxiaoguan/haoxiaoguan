import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createQuotaTestOrm, insertAccount, type TestOrm } from './test-orm'
import { MikroOrmQuotaCacheRepository } from '../../../src/main/contexts/quota/infrastructure/mikro-orm-quota-cache-repository'
import { MikroOrmQuotaStateRepository } from '../../../src/main/contexts/quota/infrastructure/mikro-orm-quota-state-repository'
import { ModelQuota, QuotaInfo } from '../../../src/main/contexts/quota/domain/quota'
import { AccountQuotaState } from '../../../src/main/contexts/quota/domain/quota-state'

let testOrm: TestOrm
const ACCOUNT_ID = '11111111-1111-1111-1111-111111111111'

beforeEach(async () => {
  testOrm = await createQuotaTestOrm()
  await insertAccount(testOrm.em(), ACCOUNT_ID)
})

afterEach(async () => {
  await testOrm.close()
})

describe('MikroOrmQuotaCacheRepository', () => {
  it('saves and reads back models', async () => {
    const repo = new MikroOrmQuotaCacheRepository(testOrm.em)
    const now = new Date()
    await repo.save(
      new QuotaInfo(
        ACCOUNT_ID,
        [new ModelQuota('gpt-4', 50, 100, now), new ModelQuota('claude-3.5', 90, 100)],
        now,
      ),
    )
    const got = await repo.get(ACCOUNT_ID)
    expect(got).not.toBeNull()
    expect(got!.models.length).toBe(2)
    const gpt = got!.models.find((m) => m.modelName === 'gpt-4')!
    expect(gpt.used).toBe(50)
    expect(gpt.resetAt).toBeInstanceOf(Date)
    const claude = got!.models.find((m) => m.modelName === 'claude-3.5')!
    expect(claude.used).toBe(90)
    expect(claude.resetAt).toBeUndefined()
  })

  it('returns null for an account with no rows', async () => {
    const repo = new MikroOrmQuotaCacheRepository(testOrm.em)
    expect(await repo.get(ACCOUNT_ID)).toBeNull()
  })

  it('replaces existing rows on save (delete-all then re-insert)', async () => {
    const repo = new MikroOrmQuotaCacheRepository(testOrm.em)
    await repo.save(new QuotaInfo(ACCOUNT_ID, [new ModelQuota('gpt-4', 10, 100)], new Date()))
    await repo.save(
      new QuotaInfo(
        ACCOUNT_ID,
        [new ModelQuota('gpt-4', 80, 100), new ModelQuota('claude-3.5', 20, 50)],
        new Date(),
      ),
    )
    const got = await repo.get(ACCOUNT_ID)
    expect(got!.models.length).toBe(2)
    expect(got!.models.find((m) => m.modelName === 'gpt-4')!.used).toBe(80)
  })

  it('empty models list inserts nothing', async () => {
    const repo = new MikroOrmQuotaCacheRepository(testOrm.em)
    await repo.save(new QuotaInfo(ACCOUNT_ID, [], new Date()))
    expect(await repo.get(ACCOUNT_ID)).toBeNull()
  })

  it('delete removes all rows', async () => {
    const repo = new MikroOrmQuotaCacheRepository(testOrm.em)
    await repo.save(new QuotaInfo(ACCOUNT_ID, [new ModelQuota('gpt-4', 50, 100)], new Date()))
    await repo.delete(ACCOUNT_ID)
    expect(await repo.get(ACCOUNT_ID)).toBeNull()
  })
})

describe('MikroOrmQuotaStateRepository', () => {
  function sampleState(): AccountQuotaState {
    return new AccountQuotaState({
      version: 1,
      status: 'warning',
      primaryMetricKey: 'total',
      metrics: [
        {
          key: 'total',
          label: 'Total Usage',
          kind: 'usage',
          unit: 'percent',
          used: 95,
          total: 100,
          remaining: 5,
          percentUsed: 95,
          percentRemaining: 5,
          displayValue: '95%',
          window: undefined,
          resetAt: undefined,
          status: 'warning',
        },
      ],
      fetchedAt: new Date(),
      error: undefined,
      providerPayload: { plan: 'pro', access_token: 'secret', headers: { authorization: 'Bearer secret' } },
    })
  }

  it('saves, reads, and replaces state; sanitises the payload', async () => {
    const repo = new MikroOrmQuotaStateRepository(testOrm.em)
    await repo.save(ACCOUNT_ID, sampleState())

    const got = await repo.get(ACCOUNT_ID)
    expect(got!.status).toBe('warning')
    expect(got!.metrics[0].displayValue).toBe('95%')
    // sensitive keys stripped on persist
    const payload = got!.providerPayload as any
    expect(payload.plan).toBe('pro')
    expect(payload.access_token).toBeUndefined()
    expect(payload.headers.authorization).toBeUndefined()

    // verify summary columns persisted
    const row = await testOrm
      .em()
      .getConnection()
      .execute(
        'SELECT quota_status, primary_unit, primary_percent FROM account_quota_state WHERE account_id = ?',
        [ACCOUNT_ID],
      )
    expect(row[0].quota_status).toBe('warning')
    expect(row[0].primary_unit).toBe('percent')
    expect(row[0].primary_percent).toBe(95)

    // replace
    const second = sampleState()
    second.status = 'ok'
    second.metrics[0].displayValue = '40%'
    await repo.save(ACCOUNT_ID, second)
    const updated = await repo.get(ACCOUNT_ID)
    expect(updated!.status).toBe('ok')
    expect(updated!.metrics[0].displayValue).toBe('40%')
  })

  it('delete removes the row', async () => {
    const repo = new MikroOrmQuotaStateRepository(testOrm.em)
    await repo.save(ACCOUNT_ID, sampleState())
    await repo.delete(ACCOUNT_ID)
    expect(await repo.get(ACCOUNT_ID)).toBeNull()
  })
})
