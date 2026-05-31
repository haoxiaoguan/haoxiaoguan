// DiscoveryService -- discover skills from GitHub repos and skills.sh.
// Mirrors Rust modules::skill::application::discovery_service.

import type { SkillRepoRepository } from '../domain/skill-repo-repository'
import { SkillRepo } from '../domain/skill-repo'
import type { DiscoverableSkill } from '../domain/installed-skill'
import { GitHubDiscoverer } from '../infrastructure/github-discoverer'
import { SkillsShClient } from '../infrastructure/skills-sh-client'

export class DiscoveryService {
  private readonly github: GitHubDiscoverer
  private readonly skillsSh: SkillsShClient

  constructor(private readonly repoRepository: SkillRepoRepository) {
    this.github = new GitHubDiscoverer()
    this.skillsSh = new SkillsShClient()
  }

  /** Discover skills from all enabled repos. Single-repo failures are silently skipped. */
  async discoverAvailable(): Promise<DiscoverableSkill[]> {
    const repos = await this.repoRepository.findEnabled()
    const all: DiscoverableSkill[] = []
    for (const repo of repos) {
      try {
        const skills = await this.github.discover(repo.owner, repo.name, repo.branch)
        all.push(...skills)
      } catch {
        // Single-repo failure does not affect others
      }
    }
    return all
  }

  /** Search skills.sh -- returns empty list on any error. */
  async searchSkillsSh(query: string, limit: number, offset: number): Promise<DiscoverableSkill[]> {
    try {
      return await this.skillsSh.search(query, limit, offset)
    } catch {
      return []
    }
  }

  async getRepos(): Promise<SkillRepo[]> {
    return this.repoRepository.findAll()
  }

  async addRepo(repo: SkillRepo): Promise<void> {
    return this.repoRepository.save(repo)
  }

  async removeRepo(owner: string, name: string): Promise<void> {
    return this.repoRepository.delete(owner, name)
  }
}
