import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import { AccountEntity } from '../../../src/main/contexts/account/infrastructure/account.entity'
import { QuotaCacheEntity } from '../../../src/main/contexts/quota/infrastructure/quota-cache.entity'
import { AccountQuotaStateEntity } from '../../../src/main/contexts/quota/infrastructure/account-quota-state.entity'

// In-memory MikroORM for the quota repository round-trip tests. Registers the
// account entity (FK target) plus the two quota entities explicitly (not the
// filesystem glob — MikroORM cannot dynamically import .ts under vitest). swc
// (vitest.config.ts) emits the decorator metadata ReflectMetadataProvider reads.

export interface TestOrm {
  orm: MikroORM
  em: () => EntityManager
  close: () => Promise<void>
}

export async function createQuotaTestOrm(): Promise<TestOrm> {
  const orm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [AccountEntity, QuotaCacheEntity, AccountQuotaStateEntity],
    discovery: { warnWhenNoEntities: false },
    allowGlobalContext: true,
  })
  const conn = orm.em.getConnection()
  await conn.execute('PRAGMA foreign_keys = ON')
  await orm.getSchemaGenerator().createSchema()
  return {
    orm,
    em: () => orm.em.fork(),
    close: () => orm.close(true),
  }
}

// Insert a bare accounts row so quota_cache / account_quota_state FK inserts pass.
export async function insertAccount(em: EntityManager, id: string): Promise<void> {
  const account = new AccountEntity()
  account.id = id
  account.agentId = 'cursor'
  account.email = 'test@example.com'
  account.identityKey = 'test@example.com'
  account.displayIdentifier = 'test@example.com'
  account.profilePayloadJson = '{}'
  account.isActive = false
  account.createdAt = '2026-05-26T00:00:00.000Z'
  await em.persistAndFlush(account)
}
