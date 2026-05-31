import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import AdmZip from 'adm-zip'
import {
  packSkills,
  unpackSkills,
  unpackSkillsWithLimits,
} from '../../../src/main/contexts/sync/application/skills-archive'
import { SyncError } from '../../../src/main/contexts/sync/domain/sync-error'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'hxg-skills-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

describe('skills-archive pack', () => {
  it('packs a directory deterministically (byte-identical across runs)', async () => {
    const root = join(tmp, 'skills')
    mkdirSync(join(root, 'b'), { recursive: true })
    writeFileSync(join(root, 'a.md'), 'alpha')
    writeFileSync(join(root, 'b', 'c.md'), 'charlie')

    const zip1 = await packSkills(root)
    const zip2 = await packSkills(root)
    expect(zip1.equals(zip2)).toBe(true)

    const names = new AdmZip(zip1).getEntries().map((e) => e.entryName).sort()
    expect(names).toContain('a.md')
    expect(names).toContain('b/c.md')
  })

  it('skips hidden files', async () => {
    const root = join(tmp, 'skills')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'keep.md'), 'k')
    writeFileSync(join(root, '.hidden'), 'h')

    const zip = await packSkills(root)
    const names = new AdmZip(zip).getEntries().map((e) => e.entryName)
    expect(names).toContain('keep.md')
    expect(names).not.toContain('.hidden')
  })

  it('produces a valid (empty) zip for a missing root', async () => {
    const zip = await packSkills(join(tmp, 'does-not-exist'))
    expect(new AdmZip(zip).getEntries()).toHaveLength(0)
  })
})

describe('skills-archive unpack', () => {
  it('unpacks into root via staging (atomic replace)', async () => {
    const root = join(tmp, 'skills')
    mkdirSync(root, { recursive: true })
    writeFileSync(join(root, 'old.md'), 'old')

    const src = new AdmZip()
    src.addFile('new.md', Buffer.from('new-content'))
    await unpackSkills(root, src.toBuffer())

    expect(existsSync(join(root, 'new.md'))).toBe(true)
    expect(readFileSync(join(root, 'new.md'), 'utf8')).toBe('new-content')
    // Old content replaced wholesale.
    expect(existsSync(join(root, 'old.md'))).toBe(false)
  })

  it('prevents path traversal (entries escaping root are skipped)', async () => {
    const root = join(tmp, 'skills')
    const zip = new AdmZip()
    zip.addFile('safe.md', Buffer.from('ok'))
    // Craft a traversal entry name.
    zip.addFile('../escape.md', Buffer.from('evil'))

    await unpackSkills(root, zip.toBuffer())
    expect(existsSync(join(root, 'safe.md'))).toBe(true)
    // The escaping file must NOT have been written outside root.
    expect(existsSync(join(tmp, 'escape.md'))).toBe(false)
  })

  it('rejects an archive exceeding the entry-count limit', async () => {
    const zip = new AdmZip()
    zip.addFile('a.md', Buffer.from('a'))
    zip.addFile('b.md', Buffer.from('b'))
    await expect(
      unpackSkillsWithLimits(join(tmp, 'skills'), zip.toBuffer(), 1, 1024 * 1024),
    ).rejects.toBeInstanceOf(SyncError)
  })

  it('rejects an archive exceeding the byte limit', async () => {
    const zip = new AdmZip()
    zip.addFile('big.bin', Buffer.alloc(2048, 1))
    await expect(
      unpackSkillsWithLimits(join(tmp, 'skills'), zip.toBuffer(), 100, 1024),
    ).rejects.toBeInstanceOf(SyncError)
  })
})
