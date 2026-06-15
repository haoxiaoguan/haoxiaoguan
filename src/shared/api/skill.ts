// 技能 DTO（skill manifest §7）。

export interface InstalledSkillDto {
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
  storage_location: string
}

export interface DiscoverableSkillDto {
  name: string
  description?: string
  directory: string
  repo_owner: string
  repo_name: string
  repo_branch: string
  readme_url?: string
  metadata?: { author?: string; version?: string; tags: string[] }
}

export interface SkillBackupEntryDto {
  backup_id: string
  skill_id: string
  snapshot_json: string
  archive_path: string
  created_at: number
}

export interface SkillRepoDto {
  owner: string
  name: string
  branch: string
  enabled: boolean
  sort_order: number
  added_at: number
}

export interface UnmanagedSkillEntryDto {
  dir_name: string
  path: string
  description?: string
}
