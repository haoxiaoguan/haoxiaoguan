import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import { AccountEntity } from '../../../src/main/contexts/account/infrastructure/account.entity'
import { AccountTagEntity } from '../../../src/main/contexts/account/infrastructure/account-tag.entity'
import { SwitchHistoryEntity } from '../../../src/main/contexts/account/infrastructure/switch-history.entity'
import { CredentialEntity } from '../../../src/main/contexts/credential/infrastructure/credential.entity'

// In-memory MikroORM for unit tests. We register the account entity CLASSES
// explicitly (not the filesystem glob) because MikroORM's runtime glob
// discovery dynamically import()s `.ts` files, which Node cannot load under
// vitest. The production runtime uses the compiled `.js` glob in
// mikro-orm.config.ts and is unaffected. swc (configured in vitest.config.ts)
// emits the decorator metadata that ReflectMetadataProvider reads.

export interface TestOrm {
  orm: MikroORM
  em: () => EntityManager
  close: () => Promise<void>
}

export async function createTestOrm(): Promise<TestOrm> {
  const orm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [AccountEntity, AccountTagEntity, SwitchHistoryEntity, CredentialEntity],
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
