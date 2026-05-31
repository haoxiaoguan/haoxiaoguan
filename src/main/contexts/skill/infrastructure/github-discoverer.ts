// GitHubDiscoverer -- fetches skill directories from a GitHub repo tree.
// GET https://api.github.com/repos/{owner}/{name}/git/trees/{branch}?recursive=1
// Returns empty list on non-2xx (rate-limit, 404, etc.) -- mirrors Rust behaviour.

import { SkillError } from '../domain/skill-error'
import type { DiscoverableSkill } from '../domain/installed-skill'

interface TreeEntry {
  path: string
  type: string
}

interface TreeResponse {
  tree: TreeEntry[]
}

export class GitHubDiscoverer {
  async discover(owner: string, name: string, branch: string): Promise<DiscoverableSkill[]> {
    const url = `https://api.github.com/repos/${owner}/${name}/git/trees/${branch}?recursive=1`

    let resp: Response
    try {
      resp = await fetch(url, {
        headers: {
          'User-Agent': 'haoxiaoguan',
          Accept: 'application/vnd.github.v3+json',
        },
      })
    } catch (e) {
      throw SkillError.network(String(e))
    }

    if (!resp.ok) {
      // Rate-limit or other error -- return empty list (mirrors Rust)
      return []
    }

    let tree: TreeResponse
    try {
      tree = (await resp.json()) as TreeResponse
    } catch (e) {
      throw SkillError.network(`failed to parse GitHub response: ${String(e)}`)
    }

    // Collect top-level directories (no '/' in path, type='tree')
    const topLevelDirs = tree.tree
      .filter((e) => e.type === 'tree' && !e.path.includes('/'))
      .map((e) => e.path)

    // Keep only dirs that contain at least one .md or .txt file (heuristic)
    const skills: DiscoverableSkill[] = topLevelDirs
      .filter((dir) =>
        tree.tree.some(
          (e) =>
            e.path.startsWith(`${dir}/`) &&
            e.type === 'blob' &&
            (e.path.endsWith('.md') || e.path.endsWith('.txt')),
        ),
      )
      .map((dir) => ({
        name: dir,
        description: undefined,
        directory: dir,
        repo_owner: owner,
        repo_name: name,
        repo_branch: branch,
        readme_url: `https://github.com/${owner}/${name}/tree/${branch}/${dir}`,
        metadata: { tags: [] },
      }))

    return skills
  }
}
