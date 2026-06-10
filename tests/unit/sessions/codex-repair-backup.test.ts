import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { CodexRepairBackup } from '../../../src/main/contexts/sessions/infrastructure/codex-repair-backup'

let root: string
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), 'hxg-bak-')) })
afterEach(async () => { await rm(root, { recursive: true, force: true }) })

describe('CodexRepairBackup', () => {
  it('备份 db 文件并可恢复', async () => {
    const dbPath = join(root, 'state_5.sqlite')
    await writeFile(dbPath, 'ORIGINAL')
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(dbPath, [{ path: join(root, 'r.jsonl'), oldProvider: 'openai' }])
    expect(id).toMatch(/.+/)
    await writeFile(dbPath, 'MUTATED')
    await backup.restoreDbOnly(id, dbPath)
    expect(await readFile(dbPath, 'utf8')).toBe('ORIGINAL')
  })

  it('manifest 记录 rollout 旧值', async () => {
    const dbPath = join(root, 'state_5.sqlite')
    await writeFile(dbPath, 'X')
    const backup = new CodexRepairBackup(join(root, 'backups'))
    const id = await backup.capture(dbPath, [{ path: '/r/a.jsonl', oldProvider: 'openai' }])
    const m = await backup.readManifest(id)
    expect(m.rollout).toEqual([{ path: '/r/a.jsonl', oldProvider: 'openai' }])
    expect(existsSync(join(root, 'backups', id, 'manifest.json'))).toBe(true)
  })
})
