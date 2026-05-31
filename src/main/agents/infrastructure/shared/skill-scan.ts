// Skill directory scanning — mirrors Rust
// agents::infrastructure::shared::skill_scan.
//
// scan_skills_dir returns only non-dotfile subdirs that contain SKILL.md.
// parse_skill_description does a lightweight YAML-frontmatter parse (no YAML
// dependency) replicating the source's exact rules, so behavior matches
// byte-for-byte.

import { existsSync, readdirSync, statSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { AgentError } from '../../domain/agent-error'
import type { UnmanagedSkillEntry } from '../../domain/skills-sync'

/** Scan `root` for skill subdirs (contain SKILL.md, not dotfiles). [] if root absent. */
export function scanSkillsDir(root: string): UnmanagedSkillEntry[] {
  if (!existsSync(root)) return []
  let names: string[]
  try {
    names = readdirSync(root)
  } catch (e) {
    throw AgentError.filesystem(root, e)
  }
  const entries: UnmanagedSkillEntry[] = []
  for (const dirName of names) {
    const path = join(root, dirName)
    let isDir = false
    try {
      isDir = statSync(path).isDirectory()
    } catch {
      continue
    }
    if (!isDir) continue
    if (dirName.startsWith('.')) continue
    const skillMd = join(path, 'SKILL.md')
    if (!existsSync(skillMd)) continue
    let description: string | undefined
    try {
      description = parseSkillDescription(readFileSync(skillMd, 'utf8')) ?? undefined
    } catch {
      description = undefined
    }
    entries.push({ dir_name: dirName, path, description })
  }
  return entries
}

/**
 * Extract the `description:` field from a SKILL.md YAML frontmatter block.
 * Mirrors Rust parse_skill_description exactly:
 * - frontmatter must start with `---` (leading blank lines allowed)
 * - take the first `description:` line inside the block
 * - strip a single pair of surrounding double or single quotes, then trim
 * - return null on no frontmatter / no description / empty value
 */
export function parseSkillDescription(md: string): string | null {
  const lines = md.split('\n')
  let idx = 0

  // frontmatter must open with `---` (skip leading blank lines).
  let started = false
  for (; idx < lines.length; idx++) {
    const trimmed = lines[idx].trim()
    if (trimmed.length === 0) continue
    if (trimmed === '---') started = true
    idx++
    break
  }
  if (!started) return null

  for (; idx < lines.length; idx++) {
    const trimmed = lines[idx].trim()
    if (trimmed === '---') break // end of frontmatter
    if (trimmed.startsWith('description:')) {
      let value = trimmed.slice('description:'.length).trim()
      value = stripQuotes(value).trim()
      if (value.length === 0) return null
      return value
    }
  }
  return null
}

function stripQuotes(value: string): string {
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    return value.slice(1, -1)
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1)
  }
  return value
}

/** Unified standard skills dir ~/.agents/skills (whether or not it exists). */
export function agentsUnifiedSkillsDir(): string {
  return join(homedir(), '.agents', 'skills')
}
