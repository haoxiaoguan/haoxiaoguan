// InstalledSkill aggregate -- mirrors Rust modules::skill::domain::installed_skill.
// apps is a Record<AgentId, boolean> serialised as JSON in the apps_json DB column.
// ssot_path is always under ~/.haoxiaoguan/skills/{directory}.
// storage_location defaults to 'haoxiaoguan'.

import type { AgentId } from '../../../agents/domain/agent-id'
import { isAgentId } from '../../../agents/domain/agent-id'

export type StorageLocation = 'haoxiaoguan' | 'agent'

export function parseStorageLocation(s: string): StorageLocation {
  if (s === 'haoxiaoguan' || s === 'agent') return s
  // Unknown values default to haoxiaoguan (mirrors Rust Default impl)
  return 'haoxiaoguan'
}

export interface SkillMetadata {
  author?: string
  version?: string
  tags: string[]
}

export interface DiscoverableSkill {
  name: string
  description?: string
  directory: string
  repo_owner: string
  repo_name: string
  repo_branch: string
  readme_url?: string
  metadata?: SkillMetadata
}

export interface UnmanagedSkillEntry {
  dir_name: string
  path: string
  description?: string
}

export class InstalledSkill {
  private constructor(
    public readonly id: string,
    public readonly name: string,
    public readonly description: string | undefined,
    public readonly directory: string,
    public readonly repo_owner: string | undefined,
    public readonly repo_name: string | undefined,
    public readonly repo_branch: string | undefined,
    public readonly readme_url: string | undefined,
    /** Map of agent_id -> enabled. Mutable for toggle/import operations. */
    public apps: Record<string, boolean>,
    public readonly installed_at: number,
    public updated_at: number,
    public readonly content_hash: string | undefined,
    public readonly ssot_path: string,
    public readonly storage_location: StorageLocation,
  ) {
    if (!id) throw new Error('InstalledSkill: id is required')
    if (!name) throw new Error('InstalledSkill: name is required')
    if (!directory) throw new Error('InstalledSkill: directory is required')
    if (!ssot_path) throw new Error('InstalledSkill: ssot_path is required')
  }

  static create(params: {
    id: string
    name: string
    description?: string
    directory: string
    repo_owner?: string
    repo_name?: string
    repo_branch?: string
    readme_url?: string
    apps: Record<string, boolean>
    installed_at: number
    updated_at: number
    content_hash?: string
    ssot_path: string
    storage_location?: StorageLocation
  }): InstalledSkill {
    return new InstalledSkill(
      params.id,
      params.name,
      params.description,
      params.directory,
      params.repo_owner,
      params.repo_name,
      params.repo_branch,
      params.readme_url,
      params.apps,
      params.installed_at,
      params.updated_at,
      params.content_hash,
      params.ssot_path,
      params.storage_location ?? 'haoxiaoguan',
    )
  }

  /** Deserialise from a plain JSON object (e.g. from snapshot_json). */
  static fromJson(raw: Record<string, unknown>): InstalledSkill {
    return new InstalledSkill(
      raw.id as string,
      raw.name as string,
      raw.description as string | undefined,
      raw.directory as string,
      raw.repo_owner as string | undefined,
      raw.repo_name as string | undefined,
      raw.repo_branch as string | undefined,
      raw.readme_url as string | undefined,
      (raw.apps as Record<string, boolean>) ?? {},
      raw.installed_at as number,
      raw.updated_at as number,
      raw.content_hash as string | undefined,
      raw.ssot_path as string,
      parseStorageLocation((raw.storage_location as string) ?? 'haoxiaoguan'),
    )
  }

  toJson(): Record<string, unknown> {
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      directory: this.directory,
      repo_owner: this.repo_owner,
      repo_name: this.repo_name,
      repo_branch: this.repo_branch,
      readme_url: this.readme_url,
      apps: this.apps,
      installed_at: this.installed_at,
      updated_at: this.updated_at,
      content_hash: this.content_hash,
      ssot_path: this.ssot_path,
      storage_location: this.storage_location,
    }
  }

  /** Serialise apps map to JSON string for DB storage. */
  appsToJson(): string {
    return JSON.stringify(this.apps)
  }

  /** Parse apps JSON string from DB, silently dropping unknown agent ids. */
  static appsFromJson(json: string): Record<string, boolean> {
    try {
      const raw = JSON.parse(json) as Record<string, boolean>
      const result: Record<string, boolean> = {}
      for (const [k, v] of Object.entries(raw)) {
        if (isAgentId(k)) result[k] = v
      }
      return result
    } catch {
      return {}
    }
  }

  isEnabledFor(agentId: AgentId): boolean {
    return this.apps[agentId] === true
  }

  enabledAgents(): AgentId[] {
    return Object.entries(this.apps)
      .filter(([, enabled]) => enabled)
      .map(([id]) => id as AgentId)
  }
}
