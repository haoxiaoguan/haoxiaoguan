import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import { AccountGroupEntity } from '../../../src/main/contexts/accountGroup/infrastructure/account-group.entity'
import { AccountGroupMembershipEntity } from '../../../src/main/contexts/accountGroup/infrastructure/account-group-membership.entity'
import { AccountGroupProxyBindingEntity } from '../../../src/main/contexts/accountGroup/infrastructure/account-group-proxy-binding.entity'

// In-memory MikroORM for account-group tests, mirroring the proxy test harness.

export interface TestOrm {
  orm: MikroORM
  em: () => EntityManager
  close: () => Promise<void>
}

export async function createAccountGroupTestOrm(): Promise<TestOrm> {
  const orm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [AccountGroupEntity, AccountGroupMembershipEntity, AccountGroupProxyBindingEntity],
    discovery: { warnWhenNoEntities: false },
    allowGlobalContext: true,
  })
  await orm.getSchemaGenerator().createSchema()
  return {
    orm,
    em: () => orm.em.fork(),
    close: () => orm.close(true),
  }
}
