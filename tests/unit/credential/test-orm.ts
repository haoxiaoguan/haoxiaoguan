import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import { AccountEntity } from '../../../src/main/contexts/account/infrastructure/account.entity'
import { CredentialEntity } from '../../../src/main/contexts/credential/infrastructure/credential.entity'
import { PendingOAuthEntity } from '../../../src/main/contexts/credential/infrastructure/pending-oauth.entity'
import { PendingImportEntity } from '../../../src/main/contexts/credential/infrastructure/pending-import.entity'

// In-memory MikroORM for credential unit tests. Registers entity CLASSES
// explicitly (not the filesystem glob) because MikroORM's runtime glob discovery
// dynamically import()s `.ts` files, which Node cannot load under vitest. swc
// (configured in vitest.config.ts) emits the decorator metadata that
// ReflectMetadataProvider reads. AccountEntity is included so the accounts table
// (FK target for credentials) exists.

export interface TestOrm {
  orm: MikroORM
  em: () => EntityManager
  close: () => Promise<void>
}

export async function createTestOrm(): Promise<TestOrm> {
  const orm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [AccountEntity, CredentialEntity, PendingOAuthEntity, PendingImportEntity],
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
