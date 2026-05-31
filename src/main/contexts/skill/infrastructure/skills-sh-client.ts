// SkillsShClient -- searches skills.sh API.
// GET https://skills.sh/api/search?q={query}&limit={n}&offset={n}
// Returns empty list on any network or parse error -- mirrors Rust behaviour.
// TODO(verify): skills.sh API response shape is inferred from Rust struct; no
// official docs. The endpoint or field names may change.

import type { DiscoverableSkill } from '../domain/installed-skill'

interface SearchResult {
  name?: string
  description?: string
  directory?: string
  repo_owner?: string
  repo_name?: string
  repo_branch?: string
}

interface SearchResponse {
  results?: SearchResult[]
}

export class SkillsShClient {
  async search(query: string, limit: number, offset: number): Promise<DiscoverableSkill[]> {
    const encodedQuery = encodeURIComponent(query)
    const url = `https://skills.sh/api/search?q=${encodedQuery}&limit=${limit}&offset=${offset}`

    let resp: Response
    try {
      resp = await fetch(url, { headers: { 'User-Agent': 'haoxiaoguan' } })
    } catch {
      // Network unavailable -- return empty list
      return []
    }

    if (!resp.ok) return []

    let body: SearchResponse
    try {
      body = (await resp.json()) as SearchResponse
    } catch {
      return []
    }

    const results = body.results ?? []
    return results
      .filter((r): r is SearchResult & { directory: string } => !!(r.directory ?? r.name))
      .map((r) => {
        const directory = r.directory ?? r.name!
        return {
          name: r.name ?? directory,
          description: r.description,
          directory,
          repo_owner: r.repo_owner ?? '',
          repo_name: r.repo_name ?? '',
          repo_branch: r.repo_branch ?? 'main',
          readme_url: undefined,
          metadata: { tags: [] },
        }
      })
  }
}
