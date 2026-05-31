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
  /** Delete a single account */
  deleteAccount: (accountId: string) => Promise<void>;
  /** Batch delete accounts */
  batchDelete: (accountIds: string[]) => Promise<number>;
  /** Import a new account */
  importAccount: (request: ImportAccountRequest) => Promise<Account>;
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
