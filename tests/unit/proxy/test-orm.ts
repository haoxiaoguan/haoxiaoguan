import 'reflect-metadata'
import { MikroORM } from '@mikro-orm/better-sqlite'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { ReflectMetadataProvider } from '@mikro-orm/core'
import { ProxyEntity } from '../../../src/main/contexts/proxy/infrastructure/proxy.entity'
import { AccountProxyBindingEntity } from '../../../src/main/contexts/proxy/infrastructure/account-proxy-binding.entity'

// In-memory MikroORM for proxy unit tests. Registers the three proxy entity
// CLASSES explicitly (same rationale as the credential test-orm: runtime glob
// discovery can't load .ts under vitest; swc emits the decorator metadata).

export interface TestOrm {
  orm: MikroORM
  em: () => EntityManager
  close: () => Promise<void>
}

export async function createProxyTestOrm(): Promise<TestOrm> {
  const orm = await MikroORM.init({
    metadataProvider: ReflectMetadataProvider,
    dbName: ':memory:',
    entities: [ProxyEntity, AccountProxyBindingEntity],
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
