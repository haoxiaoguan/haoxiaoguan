// skill-scan-helper -- shared filesystem scan logic for unmanaged skill discovery.
// Mirrors Rust agents::infrastructure::shared::skill_scan.
// Scans a directory for subdirs containing SKILL.md (not starting with '.').
// Uses js-yaml to parse SKILL.md frontmatter for the description field.

import { readdirSync, statSync, readFileSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import yaml from 'js-yaml'
import type { UnmanagedSkillEntry } from '../domain/installed-skill'

interface SkillFrontmatter {
  description?: string
  [key: string]: unknown
}

function parseSkillDescription(skillMdPath: string): string | undefined {
  try {
    const content = readFileSync(skillMdPath, 'utf8')
    // Extract YAML frontmatter between --- delimiters
    const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---/)
    if (!match) return undefined
    const fm = yaml.load(match[1]) as SkillFrontmatter
    return typeof fm?.description === 'string' ? fm.description : undefined
  } catch {
    return undefined
  }
}

/**
 * Scan a directory for unmanaged skill entries.
 * Only includes subdirs that:
 *   - do not start with '.'
 *   - contain a SKILL.md file
 */
export async function scanSkillsDir(dir: string): Promise<UnmanagedSkillEntry[]> {
  if (!existsSync(dir)) return []

  let entries: string[]
  try {
    entries = readdirSync(dir)
  } catch {
    return []
  }

  const results: UnmanagedSkillEntry[] = []
  for (const entry of entries) {
    if (entry.startsWith('.')) continue
    const fullPath = join(dir, entry)
    try {
      const stat = statSync(fullPath)
      if (!stat.isDirectory()) continue
    } catch {
      continue
    }
    const skillMdPath = join(fullPath, 'SKILL.md')
    if (!existsSync(skillMdPath)) continue
    const description = parseSkillDescription(skillMdPath)
    results.push({ dir_name: entry, path: fullPath, description })
  }
  return results
}
