import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { MikroOrmAccountGroupRepository } from '../../../src/main/contexts/accountGroup/infrastructure/mikro-orm-account-group-repository'
import { AccountGroupError } from '../../../src/main/contexts/accountGroup/domain/account-group'
import { createAccountGroupTestOrm, type TestOrm } from './test-orm'

describe('MikroOrmAccountGroupRepository', () => {
  let testOrm: TestOrm
  let repo: MikroOrmAccountGroupRepository

  beforeEach(async () => {
    testOrm = await createAccountGroupTestOrm()
    repo = new MikroOrmAccountGroupRepository(testOrm.em)
  })

  afterEach(async () => {
    await testOrm.close()
  })

  it('creates and reads back a group', async () => {
    const created = await repo.create({ name: 'Alpha', color: '#abcdef' })
    expect(created.id).toBeTruthy()
    const fetched = await repo.getById(created.id)
    expect(fetched?.name).toBe('Alpha')
    expect(fetched?.color).toBe('#abcdef')
  })

  it('rejects duplicate names with a typed error', async () => {
    await repo.create({ name: 'dup' })
    await expect(repo.create({ name: 'dup' })).rejects.toBeInstanceOf(AccountGroupError)
  })

  it('add/remove members is idempotent and reflected in countMembers', async () => {
    const g = await repo.create({ name: 'g1' })
    expect(await repo.addMembers(g.id, ['a', 'b'])).toBe(2)
    expect(await repo.addMembers(g.id, ['a', 'c'])).toBe(1) // only c is new
    expect(await repo.countMembers(g.id)).toBe(3)
    expect(await repo.removeMembers(g.id, ['b'])).toBe(1)
    expect(await repo.countMembers(g.id)).toBe(2)
  })

  it('listGroupsForAccount returns only the groups containing that account', async () => {
    const g1 = await repo.create({ name: 'g1' })
    const g2 = await repo.create({ name: 'g2' })
    await repo.addMembers(g1.id, ['acc-1'])
    await repo.addMembers(g2.id, ['acc-2'])
    const forAcc1 = await repo.listGroupsForAccount('acc-1')
    expect(forAcc1.map((g) => g.id)).toEqual([g1.id])
    const forAcc2 = await repo.listGroupsForAccount('acc-2')
    expect(forAcc2.map((g) => g.id)).toEqual([g2.id])
  })

  it('proxy binding upserts a single row per group', async () => {
    const g = await repo.create({ name: 'g1' })
    await repo.setProxyBinding(g.id, { proxyId: 'p-1' })
    const first = await repo.getProxyBinding(g.id)
    expect(first?.proxyId).toBe('p-1')
    // Re-binding to a different proxy replaces the row.
    await repo.setProxyBinding(g.id, { proxyId: 'p-2' })
    const second = await repo.getProxyBinding(g.id)
    expect(second?.proxyId).toBe('p-2')
    await repo.clearProxyBinding(g.id)
    expect(await repo.getProxyBinding(g.id)).toBeNull()
  })

  it('delete cascades to memberships and proxy binding', async () => {
    const g = await repo.create({ name: 'g1' })
    await repo.addMembers(g.id, ['a', 'b'])
    await repo.setProxyBinding(g.id, { proxyId: 'p-1' })
    await repo.delete(g.id)
    expect(await repo.getById(g.id)).toBeNull()
    expect(await repo.countMembers(g.id)).toBe(0)
    expect(await repo.getProxyBinding(g.id)).toBeNull()
  })
})
