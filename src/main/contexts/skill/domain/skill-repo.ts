// SkillRepo entity -- mirrors Rust modules::skill::domain::skill_repo.
// Composite PK: (owner, name). Upsert on conflict updates branch/enabled/sort_order.

export class SkillRepo {
  private constructor(
    public readonly owner: string,
    public readonly name: string,
    public readonly branch: string,
    public readonly enabled: boolean,
    public readonly sort_order: number,
    public readonly added_at: number,
  ) {
    if (!owner) throw new Error('SkillRepo: owner is required')
    if (!name) throw new Error('SkillRepo: name is required')
    if (!branch) throw new Error('SkillRepo: branch is required')
  }

  static create(params: {
    owner: string
    name: string
    branch: string
    enabled?: boolean
    sort_order?: number
    added_at: number
  }): SkillRepo {
    return new SkillRepo(
      params.owner,
      params.name,
      params.branch,
      params.enabled ?? true,
      params.sort_order ?? 99,
      params.added_at,
    )
  }

  fullName(): string {
    return `${this.owner}/${this.name}`
  }

  githubUrl(): string {
    return `https://github.com/${this.owner}/${this.name}`
  }
}
