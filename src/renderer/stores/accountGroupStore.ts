import { create } from 'zustand';
import type {
  AccountGroupDto,
  AccountGroupMembershipDto,
  CreateAccountGroupRequest,
  UpdateAccountGroupRequest,
} from '@shared/api-types';
import { accountGroupService } from '../services/tauri';

// AccountGroupStore — keeps the renderer's view of cross-platform account
// groupings. Membership lookups are cached per-group (loaded lazily on demand).

interface AccountGroupState {
  groups: AccountGroupDto[];
  /** groupId → list of membership rows (lazy-loaded by listMembers). */
  membersByGroup: Map<string, AccountGroupMembershipDto[]>;
  /** accountId → groups containing that account (lazy-loaded). */
  groupsByAccount: Map<string, AccountGroupDto[]>;
  loading: boolean;
  error: string | null;

  fetchGroups: () => Promise<void>;
  createGroup: (req: CreateAccountGroupRequest) => Promise<AccountGroupDto>;
  updateGroup: (id: string, patch: UpdateAccountGroupRequest) => Promise<AccountGroupDto>;
  deleteGroup: (id: string, force?: boolean) => Promise<void>;

  listMembers: (groupId: string) => Promise<AccountGroupMembershipDto[]>;
  listGroupsForAccount: (accountId: string) => Promise<AccountGroupDto[]>;

  addMembers: (groupId: string, accountIds: string[]) => Promise<number>;
  removeMembers: (groupId: string, accountIds: string[]) => Promise<number>;

  bindGroupToProxy: (groupId: string, proxyId: string) => Promise<void>;
  unbindGroup: (groupId: string) => Promise<void>;

  clearError: () => void;
}

export const useAccountGroupStore = create<AccountGroupState>((set, get) => ({
  groups: [],
  membersByGroup: new Map(),
  groupsByAccount: new Map(),
  loading: false,
  error: null,

  fetchGroups: async () => {
    set({ loading: true, error: null });
    try {
      const groups = await accountGroupService.listGroups();
      set({ groups, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  createGroup: async (req) => {
    set({ error: null });
    try {
      const group = await accountGroupService.createGroup(req);
      set({ groups: [...get().groups, group] });
      return group;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  updateGroup: async (id, patch) => {
    set({ error: null });
    try {
      const next = await accountGroupService.updateGroup(id, patch);
      set({ groups: get().groups.map((g) => (g.id === id ? next : g)) });
      return next;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  deleteGroup: async (id, force = false) => {
    set({ error: null });
    try {
      await accountGroupService.deleteGroup(id, force);
      const nextMembers = new Map(get().membersByGroup);
      nextMembers.delete(id);
      set({
        groups: get().groups.filter((g) => g.id !== id),
        membersByGroup: nextMembers,
      });
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  listMembers: async (groupId) => {
    const cached = get().membersByGroup.get(groupId);
    if (cached !== undefined) return cached;
    const members = await accountGroupService.listMembers(groupId);
    const next = new Map(get().membersByGroup);
    next.set(groupId, members);
    set({ membersByGroup: next });
    return members;
  },

  listGroupsForAccount: async (accountId) => {
    const cached = get().groupsByAccount.get(accountId);
    if (cached !== undefined) return cached;
    const groups = await accountGroupService.listGroupsForAccount(accountId);
    const next = new Map(get().groupsByAccount);
    next.set(accountId, groups);
    set({ groupsByAccount: next });
    return groups;
  },

  addMembers: async (groupId, accountIds) => {
    set({ error: null });
    try {
      const { added } = await accountGroupService.addMembers(groupId, accountIds);
      // Invalidate caches and re-fetch the group's count.
      const nextMembers = new Map(get().membersByGroup);
      nextMembers.delete(groupId);
      const nextByAccount = new Map(get().groupsByAccount);
      for (const id of accountIds) nextByAccount.delete(id);
      set({ membersByGroup: nextMembers, groupsByAccount: nextByAccount });
      await get().fetchGroups();
      return added;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  removeMembers: async (groupId, accountIds) => {
    set({ error: null });
    try {
      const { removed } = await accountGroupService.removeMembers(groupId, accountIds);
      const nextMembers = new Map(get().membersByGroup);
      nextMembers.delete(groupId);
      const nextByAccount = new Map(get().groupsByAccount);
      for (const id of accountIds) nextByAccount.delete(id);
      set({ membersByGroup: nextMembers, groupsByAccount: nextByAccount });
      await get().fetchGroups();
      return removed;
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  bindGroupToProxy: async (groupId, proxyId) => {
    set({ error: null });
    try {
      await accountGroupService.bindGroupToProxy(groupId, proxyId);
      await get().fetchGroups();
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  unbindGroup: async (groupId) => {
    set({ error: null });
    try {
      await accountGroupService.unbindGroup(groupId);
      await get().fetchGroups();
    } catch (err) {
      set({ error: String(err) });
      throw err;
    }
  },

  clearError: () => set({ error: null }),
}));
