import {
  AccountGroupError,
  normalizeAccountGroupColor,
  normalizeAccountGroupDescription,
  normalizeAccountGroupName,
} from '../domain/account-group'
import type { MikroOrmAccountGroupRepository } from '../infrastructure/mikro-orm-account-group-repository'

// AccountGroup application service. Owns:
//   - CRUD on the group itself (with name/color/description normalization)
//   - membership management (add/remove/list, with member-count caching)
//   - group↔proxy binding (single proxy or single proxy-group, optional)
//
// Delete protection: a group with active members refuses deletion unless the
// caller passes `force: true` (which also wipes memberships + proxy binding).
// This mirrors the proxy context's "delete-while-bound" guard in spirit while
// staying pragmatic — mass-deletion of an empty group is the common case.

/** Renderer-facing DTO. Color/description are omitted when unset. */
export interface AccountGroupDto {
  id: string
  name: string
  color?: string | undefined
  description?: string | undefined
  memberCount: number
  proxyBinding?: AccountGroupBindingDto | undefined
  createdAt: string
  updatedAt: string
}

export interface AccountGroupBindingDto {
  groupId: string
  proxyId?: string | undefined
}

export interface AccountGroupMembershipDto {
  groupId: string
  accountId: string
  createdAt: string
}

export class AccountGroupService {
  constructor(private readonly repo: MikroOrmAccountGroupRepository) {}

  async createGroup(input: {
    name: string
    color?: string
    description?: string
  }): Promise<AccountGroupDto> {
    const name = normalizeAccountGroupName(input.name)
    const color = normalizeAccountGroupColor(input.color)
    const description = normalizeAccountGroupDescription(input.description)
    const group = await this.repo.create({ name, color, description })
    return this.toDto(group, 0, undefined)
  }

  async updateGroup(
    id: string,
    patch: { name?: string; color?: string | null; description?: string | null },
  ): Promise<AccountGroupDto> {
    const normalized: { name?: string; color?: string | null; description?: string | null } = {}
    if (patch.name !== undefined) {
      normalized.name = normalizeAccountGroupName(patch.name)
    }
    if (patch.color !== undefined) {
      normalized.color =
        patch.color === null ? null : (normalizeAccountGroupColor(patch.color) ?? null)
    }
    if (patch.description !== undefined) {
      normalized.description =
        patch.description === null
          ? null
          : (normalizeAccountGroupDescription(patch.description) ?? null)
    }
    const group = await this.repo.update(id, normalized)
    const [memberCount, binding] = await Promise.all([
      this.repo.countMembers(id),
      this.repo.getProxyBinding(id),
    ])
    return this.toDto(
      group,
      memberCount,
      binding === null ? undefined : { groupId: binding.groupId, proxyId: binding.proxyId },
    )
  }

  async deleteGroup(id: string, options: { force?: boolean } = {}): Promise<void> {
    const memberCount = await this.repo.countMembers(id)
    if (memberCount > 0 && options.force !== true) {
      throw AccountGroupError.inUse(id, memberCount)
    }
    await this.repo.delete(id)
  }

  async listGroups(): Promise<AccountGroupDto[]> {
    const groups = await this.repo.list()
    if (groups.length === 0) return []
    const memberships = await this.repo.listAllMemberships()
    const bindings = await this.repo.listProxyBindings()
    const counts = new Map<string, number>()
    for (const m of memberships) counts.set(m.groupId, (counts.get(m.groupId) ?? 0) + 1)
    const bindingByGroup = new Map(bindings.map((b) => [b.groupId, b] as const))
    return groups.map((g) => {
      const b = bindingByGroup.get(g.id)
      return this.toDto(
        g,
        counts.get(g.id) ?? 0,
        b === undefined ? undefined : { groupId: b.groupId, proxyId: b.proxyId },
      )
    })
  }

  // --- memberships ---

  async addMembers(groupId: string, accountIds: string[]): Promise<{ added: number }> {
    const exists = await this.repo.getById(groupId)
    if (exists === null) throw AccountGroupError.notFound(groupId)
    // Single-group invariant: an account belongs to at most ONE group. Before
    // adding to this group, evict each account from every OTHER group it's in.
    for (const accountId of accountIds) {
      const current = await this.repo.listGroupsForAccount(accountId)
      for (const g of current) {
        if (g.id !== groupId) await this.repo.removeMembers(g.id, [accountId])
      }
    }
    const added = await this.repo.addMembers(groupId, accountIds)
    return { added }
  }

  async removeMembers(groupId: string, accountIds: string[]): Promise<{ removed: number }> {
    const removed = await this.repo.removeMembers(groupId, accountIds)
    return { removed }
  }

  async listMembers(groupId: string): Promise<AccountGroupMembershipDto[]> {
    const rows = await this.repo.listMembers(groupId)
    return rows.map((r) => ({
      groupId: r.groupId,
      accountId: r.accountId,
      createdAt: r.createdAt.toISOString(),
    }))
  }

  async listGroupsForAccount(accountId: string): Promise<AccountGroupDto[]> {
    const groups = await this.repo.listGroupsForAccount(accountId)
    if (groups.length === 0) return []
    const out: AccountGroupDto[] = []
    for (const g of groups) {
      const [memberCount, binding] = await Promise.all([
        this.repo.countMembers(g.id),
        this.repo.getProxyBinding(g.id),
      ])
      out.push(
        this.toDto(
          g,
          memberCount,
          binding === null ? undefined : { groupId: binding.groupId, proxyId: binding.proxyId },
        ),
      )
    }
    return out
  }

  // --- proxy binding ---

  async bindGroupToProxy(groupId: string, proxyId: string): Promise<AccountGroupBindingDto> {
    const exists = await this.repo.getById(groupId)
    if (exists === null) throw AccountGroupError.notFound(groupId)
    await this.repo.setProxyBinding(groupId, { proxyId })
    return { groupId, proxyId }
  }

  async unbindGroup(groupId: string): Promise<void> {
    await this.repo.clearProxyBinding(groupId)
  }

  async getGroupBinding(groupId: string): Promise<AccountGroupBindingDto | null> {
    const b = await this.repo.getProxyBinding(groupId)
    return b === null ? null : { groupId: b.groupId, proxyId: b.proxyId }
  }

  // --- mapping ---

  private toDto(
    group: { id: string; name: string; color?: string | undefined; description?: string | undefined; createdAt: Date; updatedAt: Date },
    memberCount: number,
    binding: AccountGroupBindingDto | undefined,
  ): AccountGroupDto {
    return {
      id: group.id,
      name: group.name,
      color: group.color,
      description: group.description,
      memberCount,
      proxyBinding: binding,
      createdAt: group.createdAt.toISOString(),
      updatedAt: group.updatedAt.toISOString(),
    }
  }
}
