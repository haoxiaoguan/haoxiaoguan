import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MikroOrmAccountGroupRepository } from '../../../src/main/contexts/accountGroup/infrastructure/mikro-orm-account-group-repository'
import { AccountGroupService } from '../../../src/main/contexts/accountGroup/application/account-group-service'
import { createAccountGroupTestOrm, type TestOrm } from './test-orm'

// Service-level coverage focused on the single-group invariant: an account may
// belong to at most ONE group, so adding it to a new group evicts it from any
// group it was previously in.

describe('AccountGroupService — single-group invariant', () => {
  let testOrm: TestOrm
  let service: AccountGroupService

  beforeEach(async () => {
    testOrm = await createAccountGroupTestOrm()
    service = new AccountGroupService(new MikroOrmAccountGroupRepository(testOrm.em))
  })

  afterEach(async () => {
    await testOrm.close()
  })

  it('moves an account from its old group when added to a new one', async () => {
    const a = await service.createGroup({ name: 'A' })
    const b = await service.createGroup({ name: 'B' })

    await service.addMembers(a.id, ['acc-1'])
    let groups = await service.listGroupsForAccount('acc-1')
    expect(groups.map((g) => g.id)).toEqual([a.id])

    // Joining B must evict acc-1 from A.
    await service.addMembers(b.id, ['acc-1'])
    groups = await service.listGroupsForAccount('acc-1')
    expect(groups.map((g) => g.id)).toEqual([b.id])

    // A no longer counts acc-1.
    const list = await service.listGroups()
    expect(list.find((g) => g.id === a.id)?.memberCount).toBe(0)
    expect(list.find((g) => g.id === b.id)?.memberCount).toBe(1)
  })

  it('re-adding to the same group is a no-op (stays a member)', async () => {
    const a = await service.createGroup({ name: 'A' })
    await service.addMembers(a.id, ['acc-1'])
    await service.addMembers(a.id, ['acc-1'])
    const groups = await service.listGroupsForAccount('acc-1')
    expect(groups.map((g) => g.id)).toEqual([a.id])
  })

  it('binds a group to a single proxy and reads it back', async () => {
    const a = await service.createGroup({ name: 'A' })
    await service.bindGroupToProxy(a.id, 'p-1')
    expect((await service.getGroupBinding(a.id))?.proxyId).toBe('p-1')
    await service.unbindGroup(a.id)
    expect(await service.getGroupBinding(a.id)).toBeNull()
  })
})
