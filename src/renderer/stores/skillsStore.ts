import { create } from 'zustand';
import type { InstalledSkill, DiscoverableSkill, SkillRepo, SkillBackupEntry } from '../types';
import { skillsService } from '../services/tauri';

interface SkillsState {
  installed: InstalledSkill[];
  discoverable: DiscoverableSkill[];
  repos: SkillRepo[];
  backups: SkillBackupEntry[];
  loading: boolean;
  error: string | null;

  fetchInstalled: () => Promise<void>;
  fetchDiscoverable: () => Promise<void>;
  fetchRepos: () => Promise<void>;
  fetchBackups: () => Promise<void>;
  installSkill: (skill: DiscoverableSkill, agentId: string) => Promise<void>;
  uninstallSkill: (skillId: string) => Promise<void>;
  toggleApp: (skillId: string, agentId: string, enabled: boolean) => Promise<void>;
}

export const useSkillsStore = create<SkillsState>((set, get) => ({
  installed: [],
  discoverable: [],
  repos: [],
  backups: [],
  loading: false,
  error: null,

  fetchInstalled: async () => {
    set({ loading: true, error: null });
    try {
      const installed = await skillsService.getInstalledSkills();
      set({ installed, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchDiscoverable: async () => {
    set({ loading: true, error: null });
    try {
      const discoverable = await skillsService.discoverAvailableSkills();
      set({ discoverable, loading: false });
    } catch (e) {
      set({ error: String(e), loading: false });
    }
  },

  fetchRepos: async () => {
    try {
      const repos = await skillsService.getSkillRepos();
      set({ repos });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  fetchBackups: async () => {
    try {
      const backups = await skillsService.getSkillBackups();
      set({ backups });
    } catch (e) {
      set({ error: String(e) });
    }
  },

  installSkill: async (skill, agentId) => {
    try {
      await skillsService.installSkillUnified({
        name: skill.name,
        description: skill.description,
        directory: skill.directory,
        repo_owner: skill.repo_owner,
        repo_name: skill.repo_name,
        repo_branch: skill.repo_branch,
        readme_url: skill.readme_url,
        agent_id: agentId,
      });
      await get().fetchInstalled();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  uninstallSkill: async (skillId) => {
    try {
      await skillsService.uninstallSkillUnified(skillId);
      await get().fetchInstalled();
    } catch (e) {
      set({ error: String(e) });
    }
  },

  toggleApp: async (skillId, agentId, enabled) => {
    try {
      await skillsService.toggleSkillApp({ skill_id: skillId, agent_id: agentId, enabled });
      await get().fetchInstalled();
    } catch (e) {
      set({ error: String(e) });
    }
  },
}));
