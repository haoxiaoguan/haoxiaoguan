import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync, lstatSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DirSkillsSync } from '../../../src/main/agents/infrastructure/shared/skills-sync-base'
import { parseSkillDescription, scanSkillsDir } from '../../../src/main/agents/infrastructure/shared/skill-scan'

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'agents-skill-'))
})
afterEach(() => {
  rmSync(dir, { recursive: true, force: true })
})

describe('parseSkillDescription (frontmatter)', () => {
  it('parses a standard description', () => {
    const md = '---\nname: x\ndescription: Browser automation CLI.\n---\n\n# Body\n'
    expect(parseSkillDescription(md)).toBe('Browser automation CLI.')
  })
  it('strips double and single quotes', () => {
    expect(parseSkillDescription('---\ndescription: "Quoted"\n---\n')).toBe('Quoted')
    expect(parseSkillDescription("---\ndescription: 'Single'\n---\n")).toBe('Single')
  })
  it('allows leading blank lines', () => {
    expect(parseSkillDescription('\n\n---\ndescription: After blanks\n---\n')).toBe('After blanks')
  })
  it('returns null without frontmatter, missing description, or empty value', () => {
    expect(parseSkillDescription('# Heading\ndescription: nope\n')).toBeNull()
    expect(parseSkillDescription('---\nname: foo\n---\n')).toBeNull()
    expect(parseSkillDescription('---\ndescription:\n---\n')).toBeNull()
    expect(parseSkillDescription('')).toBeNull()
  })
  it('ignores description lines after the frontmatter block ends', () => {
    expect(parseSkillDescription('---\nname: foo\n---\ndescription: in body\n')).toBeNull()
  })
})

describe('scanSkillsDir', () => {
  it('returns only non-dotfile dirs containing SKILL.md, with descriptions', () => {
    // valid skill
    mkdirSync(join(dir, 'good'))
    writeFileSync(join(dir, 'good', 'SKILL.md'), '---\ndescription: Good one\n---\n')
    // dotfile dir — skipped
    mkdirSync(join(dir, '.hidden'))
    writeFileSync(join(dir, '.hidden', 'SKILL.md'), '---\ndescription: nope\n---\n')
    // dir without SKILL.md — skipped
    mkdirSync(join(dir, 'nomd'))
    // a file, not a dir — skipped
    writeFileSync(join(dir, 'file.txt'), 'x')

    const entries = scanSkillsDir(dir)
    expect(entries.map((e) => e.dir_name)).toEqual(['good'])
    expect(entries[0].description).toBe('Good one')
    expect(entries[0].path).toBe(join(dir, 'good'))
  })

  it('returns [] when root does not exist', () => {
    expect(scanSkillsDir(join(dir, 'absent'))).toEqual([])
  })
})

describe('DirSkillsSync', () => {
  function makeSsot(): string {
    const ssot = join(dir, 'ssot', 'my-skill')
    mkdirSync(ssot, { recursive: true })
    writeFileSync(join(ssot, 'SKILL.md'), '---\ndescription: My skill\n---\n')
    writeFileSync(join(ssot, 'extra.txt'), 'data')
    return ssot
  }

  it('syncSkill (copy) materializes files and reports outcome', async () => {
    const ssot = makeSsot()
    const root = join(dir, 'agent-skills')
    const sync = new DirSkillsSync(root)

    const outcome = await sync.syncSkill(ssot, 'my-skill', 'copy')
    expect(outcome.methodUsed).toBe('copy')
    expect(outcome.filesSynced).toBe(2)
    expect(existsSync(join(root, 'my-skill', 'SKILL.md'))).toBe(true)
    expect(readFileSync(join(root, 'my-skill', 'extra.txt'), 'utf8')).toBe('data')
    expect(await sync.hasSkill('my-skill')).toBe(true)
  })

  it('syncSkill (auto) prefers symlink on this platform', async () => {
    const ssot = makeSsot()
    const root = join(dir, 'agent-skills')
    const sync = new DirSkillsSync(root)

    const outcome = await sync.syncSkill(ssot, 'my-skill', 'auto')
    // On POSIX CI a symlink should succeed; assert the link points at the ssot.
    if (outcome.methodUsed === 'symlink') {
      expect(lstatSync(join(root, 'my-skill')).isSymbolicLink()).toBe(true)
    }
    expect(existsSync(join(root, 'my-skill', 'SKILL.md'))).toBe(true)
  })

  it('removeSkill deletes the target; no-op when absent', async () => {
    const ssot = makeSsot()
    const root = join(dir, 'agent-skills')
    const sync = new DirSkillsSync(root)
    await sync.syncSkill(ssot, 'my-skill', 'copy')
    await sync.removeSkill('my-skill')
    expect(await sync.hasSkill('my-skill')).toBe(false)
    await expect(sync.removeSkill('my-skill')).resolves.toBeUndefined()
  })

  it('scanUnmanaged delegates to scanSkillsDir over the skills root', async () => {
    const ssot = makeSsot()
    const root = join(dir, 'agent-skills')
    const sync = new DirSkillsSync(root)
    await sync.syncSkill(ssot, 'my-skill', 'copy')
    const entries = await sync.scanUnmanaged()
    expect(entries.map((e) => e.dir_name)).toEqual(['my-skill'])
    expect(sync.skillsRoot()).toBe(root)
  })
})
