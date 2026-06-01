import { randomUUID } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm } from '../../../platform/persistence/database'
import {
  AccountGroupError,
  type AccountGroup,
  type AccountGroupMembership,
  type AccountGroupProxyBinding,
} from '../domain/account-group'
import { AccountGroupEntity } from './account-group.entity'
import { AccountGroupMembershipEntity } from './account-group-membership.entity'
import { AccountGroupProxyBindingEntity } from './account-group-proxy-binding.entity'

// MikroORM-backed repository for the account-group context.
//
// Design notes:
//   - All timestamps are RFC3339 strings on disk; rehydrated to Date in the
//     domain mapping.
//   - Bulk member operations use nativeInsert/nativeDelete to avoid creating
//     N managed entities per call (see proxy repo for the same pattern).

export interface CreateAccountGroupInput {
  name: string
  color?: string
  description?: string
}

export interface UpdateAccountGroupInput {
  name?: string
  /** undefined = unchanged; null = clear; '' = clear (normalizer treats it as unset). */
  color?: string | null
  description?: string | null
}

export class MikroOrmAccountGroupRepository {
  constructor(private readonly emFactory: () => EntityManager = getEm) {}

  // --- groups ---

  async create(input: CreateAccountGroupInput): Promise<AccountGroup> {
    const em = this.emFactory()
    const id = randomUUID()
    const now = new Date().toISOString()
    const entity = new AccountGroupEntity()
    entity.id = id
    entity.name = input.name
    entity.color = input.color ?? null
    entity.description = input.description ?? null
    entity.createdAt = now
    entity.updatedAt = now
    try {
      em.persist(entity)
      await em.flush()
    } catch (e) {
      // SQLite uniqueness violation surfaces here.
      const message = e instanceof Error ? e.message : String(e)
      if (/UNIQUE|unique constraint/i.test(message)) {
        throw AccountGroupError.duplicateName(input.name)
      }
      throw AccountGroupError.storageError(message)
    }
    return this.toGroup(entity)
  }

  async update(id: string, patch: UpdateAccountGroupInput): Promise<AccountGroup> {
    const em = this.emFactory()
    const entity = await em.findOne(AccountGroupEntity, { id })
    if (entity === null) throw AccountGroupError.notFound(id)
    if (patch.name !== undefined) entity.name = patch.name
    if (patch.color !== undefined) entity.color = patch.color
    if (patch.description !== undefined) entity.description = patch.description
    entity.updatedAt = new Date().toISOString()
    try {
      await em.flush()
    } catch (e) {
      const message = e instanceof Error ? e.message : String(e)
      if (/UNIQUE|unique constraint/i.test(message) && patch.name !== undefined) {
        throw AccountGroupError.duplicateName(patch.name)
      }
      throw AccountGroupError.storageError(message)
    }
    return this.toGroup(entity)
  }

  async getById(id: string): Promise<AccountGroup | null> {
    const em = this.emFactory()
    const entity = await em.findOne(AccountGroupEntity, { id })
    return entity === null ? null : this.toGroup(entity)
  }

  async list(): Promise<AccountGroup[]> {
    const em = this.emFactory()
    const rows = await em.find(AccountGroupEntity, {}, { orderBy: { createdAt: 'asc' } })
    return rows.map((e) => this.toGroup(e))
  }

  async delete(id: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.transactional(async (tx) => {
        await tx.nativeDelete(AccountGroupMembershipEntity, { groupId: id })
        await tx.nativeDelete(AccountGroupProxyBindingEntity, { groupId: id })
        await tx.nativeDelete(AccountGroupEntity, { id })
      })
    } catch (e) {
      throw AccountGroupError.storageError(e instanceof Error ? e.message : String(e))
    }
  }

  // --- memberships ---

  async addMembers(groupId: string, accountIds: string[]): Promise<number> {
    if (accountIds.length === 0) return 0
    const em = this.emFactory()
    const now = new Date().toISOString()
    let added = 0
    try {
      await em.transactional(async (tx) => {
        for (const accountId of accountIds) {
          const existing = await tx.findOne(AccountGroupMembershipEntity, { groupId, accountId })
          if (existing !== null) continue
          const entity = new AccountGroupMembershipEntity()
          entity.groupId = groupId
          entity.accountId = accountId
          entity.createdAt = now
          tx.persist(entity)
          added += 1
        }
      })
    } catch (e) {
      throw AccountGroupError.storageError(e instanceof Error ? e.message : String(e))
    }
    return added
  }

  async removeMembers(groupId: string, accountIds: string[]): Promise<number> {
    if (accountIds.length === 0) return 0
    const em = this.emFactory()
    try {
      return await em.nativeDelete(AccountGroupMembershipEntity, {
        groupId,
        accountId: { $in: accountIds },
      })
    } catch (e) {
      throw AccountGroupError.storageError(e instanceof Error ? e.message : String(e))
    }
  }

  async listMembers(groupId: string): Promise<AccountGroupMembership[]> {
    const em = this.emFactory()
    const rows = await em.find(
      AccountGroupMembershipEntity,
      { groupId },
      { orderBy: { createdAt: 'asc' } },
    )
    return rows.map((e) => this.toMembership(e))
  }

  async listGroupsForAccount(accountId: string): Promise<AccountGroup[]> {
    const em = this.emFactory()
    const rows = await em.find(AccountGroupMembershipEntity, { accountId })
    if (rows.length === 0) return []
    const groupIds = rows.map((r) => r.groupId)
    const groups = await em.find(AccountGroupEntity, { id: { $in: groupIds } })
    return groups.map((g) => this.toGroup(g))
  }

  async listAllMemberships(): Promise<AccountGroupMembership[]> {
    const em = this.emFactory()
    const rows = await em.find(AccountGroupMembershipEntity, {})
    return rows.map((e) => this.toMembership(e))
  }

  async countMembers(groupId: string): Promise<number> {
    const em = this.emFactory()
    return em.count(AccountGroupMembershipEntity, { groupId })
  }

  // --- proxy binding ---

  async setProxyBinding(groupId: string, target: { proxyId?: string }): Promise<void> {
    const em = this.emFactory()
    try {
      let entity = await em.findOne(AccountGroupProxyBindingEntity, { groupId })
      if (entity === null) {
        entity = new AccountGroupProxyBindingEntity()
        entity.groupId = groupId
        entity.createdAt = new Date().toISOString()
        em.persist(entity)
      }
      entity.proxyId = target.proxyId ?? null
      await em.flush()
    } catch (e) {
      throw AccountGroupError.storageError(e instanceof Error ? e.message : String(e))
    }
  }

  async clearProxyBinding(groupId: string): Promise<void> {
    const em = this.emFactory()
    try {
      await em.nativeDelete(AccountGroupProxyBindingEntity, { groupId })
    } catch (e) {
      throw AccountGroupError.storageError(e instanceof Error ? e.message : String(e))
    }
  }

  async getProxyBinding(groupId: string): Promise<AccountGroupProxyBinding | null> {
    const em = this.emFactory()
    const entity = await em.findOne(AccountGroupProxyBindingEntity, { groupId })
    return entity === null ? null : this.toBinding(entity)
  }

  async listProxyBindings(): Promise<AccountGroupProxyBinding[]> {
    const em = this.emFactory()
    const rows = await em.find(AccountGroupProxyBindingEntity, {})
    return rows.map((e) => this.toBinding(e))
  }

  // --- mapping ---

  private toGroup(e: AccountGroupEntity): AccountGroup {
    return {
      id: e.id,
      name: e.name,
      color: e.color ?? undefined,
      description: e.description ?? undefined,
      createdAt: new Date(e.createdAt),
      updatedAt: new Date(e.updatedAt),
    }
  }

  private toMembership(e: AccountGroupMembershipEntity): AccountGroupMembership {
    return {
      groupId: e.groupId,
      accountId: e.accountId,
      createdAt: new Date(e.createdAt),
    }
  }

  private toBinding(e: AccountGroupProxyBindingEntity): AccountGroupProxyBinding {
    return {
      groupId: e.groupId,
      proxyId: e.proxyId ?? undefined,
      createdAt: new Date(e.createdAt),
    }
  }
}
