import { create } from 'zustand';
import type { Account, AgentId, ImportAccountRequest, FilterAccountsRequest } from '../types';
import { accountService } from '../services/tauri';

interface AccountState {
  /** Accounts grouped by agent */
  accounts: Map<AgentId, Account[]>;
  /** Currently active account per agent */
  activeAccounts: Map<AgentId, string>;
  /** Loading state */
  loading: boolean;
  /** Error message */
  error: string | null;

  /** Fetch accounts for a specific agent */
  fetchAccounts: (agentId: AgentId) => Promise<void>;
  /** Switch to a different account */
  switchAccount: (agentId: AgentId, accountId: string) => Promise<void>;
  /** Reverse-detect which account each IDE is actually using; rewrites isActive */
  detectActiveAccounts: () => Promise<void>;
  /** Delete a single account */
  deleteAccount: (accountId: string) => Promise<void>;
  /** Batch delete accounts */
  batchDelete: (accountIds: string[]) => Promise<number>;
  /** Import a new account */
  importAccount: (request: ImportAccountRequest) => Promise<Account>;
  /** Update editable metadata (name / tags / notes) */
  updateAccount: (
    accountId: string,
    patch: { name?: string | null; tags?: string[]; notes?: string | null },
  ) => Promise<Account>;
  /** Replace credentials for the same upstream identity */
  reauthenticate: (
    accountId: string,
    input: {
      identifier: string;
      token: string;
      refreshToken?: string;
      expiresAt?: string;
      rawMetadata?: unknown;
    },
  ) => Promise<Account>;
  /** Filter accounts by criteria */
  filterAccounts: (filter: FilterAccountsRequest) => Promise<Account[]>;
  /** Clear error */
  clearError: () => void;
}

export const useAccountStore = create<AccountState>((set, get) => ({
  accounts: new Map(),
  activeAccounts: new Map(),
  loading: false,
  error: null,

  fetchAccounts: async (agentId: AgentId) => {
    set({ loading: true, error: null });
    try {
      const accounts = await accountService.getAccountsByAgent(agentId);
      const currentAccounts = new Map(get().accounts);
      currentAccounts.set(agentId, accounts);

      const activeAccounts = new Map(get().activeAccounts);
      const active = accounts.find((a) => a.isActive);
      if (active) {
        activeAccounts.set(agentId, active.id);
      }

      set({ accounts: currentAccounts, activeAccounts, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  switchAccount: async (agentId: AgentId, accountId: string) => {
    set({ loading: true, error: null });
    try {
      await accountService.switchAccount(accountId);
      const activeAccounts = new Map(get().activeAccounts);
      activeAccounts.set(agentId, accountId);

      // Update the accounts list to reflect new active state
      const currentAccounts = new Map(get().accounts);
      const agentAccounts = currentAccounts.get(agentId) ?? [];
      const updated = agentAccounts.map((a) => ({
        ...a,
        isActive: a.id === accountId,
      }));
      currentAccounts.set(agentId, updated);

      set({ activeAccounts, accounts: currentAccounts, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  detectActiveAccounts: async () => {
    // Main process reads each IDE's real login state and rewrites is_active in
    // the DB. We then re-fetch every loaded platform and rebuild activeAccounts
    // from the fresh isActive flags (also clearing platforms that lost their
    // active account). Failures are swallowed — detection is best-effort.
    try {
      await accountService.detectActiveAccounts();
    } catch {
      return;
    }
    const agentIds = Array.from(get().accounts.keys());
    if (agentIds.length === 0) return;
    try {
      const lists = await Promise.all(
        agentIds.map(async (agentId) => [agentId, await accountService.getAccountsByAgent(agentId)] as const),
      );
      const accounts = new Map(get().accounts);
      const activeAccounts = new Map(get().activeAccounts);
      for (const [agentId, list] of lists) {
        accounts.set(agentId, list);
        const active = list.find((a) => a.isActive);
        if (active) activeAccounts.set(agentId, active.id);
        else activeAccounts.delete(agentId);
      }
      set({ accounts, activeAccounts });
    } catch {
      // leave state as-is on a re-fetch failure
    }
  },

  deleteAccount: async (accountId: string) => {
    set({ loading: true, error: null });
    try {
      await accountService.deleteAccount(accountId);
      // Remove from local state
      const currentAccounts = new Map(get().accounts);
      for (const [agentId, accounts] of currentAccounts) {
        const filtered = accounts.filter((a) => a.id !== accountId);
        if (filtered.length !== accounts.length) {
          currentAccounts.set(agentId, filtered);
        }
      }
      set({ accounts: currentAccounts, loading: false });
    } catch (err) {
      set({ loading: false, error: String(err) });
    }
  },

  batchDelete: async (accountIds: string[]) => {
    set({ loading: true, error: null });
    try {
      const result = await accountService.batchDelete(accountIds);
      // Remove from local state
      const currentAccounts = new Map(get().accounts);
      const idSet = new Set(accountIds);
      for (const [agentId, accounts] of currentAccounts) {
        currentAccounts.set(
          agentId,
          accounts.filter((a) => !idSet.has(a.id))
        );
      }
      set({ accounts: currentAccounts, loading: false });
      return result.deletedCount;
    } catch (err) {
      set({ loading: false, error: String(err) });
      return 0;
    }
  },

  importAccount: async (request: ImportAccountRequest) => {
    set({ loading: true, error: null });
    try {
      const account = await accountService.importAccount(request);
      // Add to local state
      const currentAccounts = new Map(get().accounts);
      const agentId = account.platform;
      const existing = currentAccounts.get(agentId) ?? [];
      currentAccounts.set(agentId, [...existing, account]);
      set({ accounts: currentAccounts, loading: false });
      return account;
    } catch (err) {
      set({ loading: false, error: String(err) });
      throw err;
    }
  },

  updateAccount: async (accountId, patch) => {
    set({ loading: true, error: null });
    try {
      const updated = await accountService.updateAccount(accountId, patch);
      const currentAccounts = new Map(get().accounts);
      const list = currentAccounts.get(updated.platform) ?? [];
      currentAccounts.set(
        updated.platform,
        list.map((a) => (a.id === updated.id ? updated : a)),
      );
      set({ accounts: currentAccounts, loading: false });
      return updated;
    } catch (err) {
      set({ loading: false, error: String(err) });
      throw err;
    }
  },

  reauthenticate: async (accountId, input) => {
    set({ loading: true, error: null });
    try {
      const updated = await accountService.reauthenticate(accountId, input);
      const currentAccounts = new Map(get().accounts);
      const list = currentAccounts.get(updated.platform) ?? [];
      currentAccounts.set(
        updated.platform,
        list.map((a) => (a.id === updated.id ? updated : a)),
      );
      set({ accounts: currentAccounts, loading: false });
      return updated;
    } catch (err) {
      set({ loading: false, error: String(err) });
      throw err;
    }
  },

  filterAccounts: async (filter: FilterAccountsRequest) => {
    try {
      return await accountService.filterAccounts(filter);
    } catch (err) {
      set({ error: String(err) });
      return [];
    }
  },

  clearError: () => set({ error: null }),
}));
