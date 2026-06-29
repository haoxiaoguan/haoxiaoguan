import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, mkdir, writeFile, utimes } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ClaudeDesktopSessionRepair } from '../../../src/main/contexts/sessions/application/claude-desktop-session-repair'

let root: string
let backups: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'hxg-claude-desktop-'))
  backups = await mkdtemp(join(tmpdir(), 'hxg-claude-desktop-bak-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
  await rm(backups, { recursive: true, force: true })
})

function repair() {
  return new ClaudeDesktopSessionRepair(root, backups, async () => false)
}

async function writeLocal(namespace: string, name: string, mtimeMs: number) {
  const p = join(root, 'claude-code-sessions', namespace, name)
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, JSON.stringify({ sessionId: name, cliSessionId: name.replace(/^local_/, '').replace(/\.json$/, '') }))
  const when = new Date(mtimeMs)
  await utimes(p, when, when)
  return p
}

async function writeLegacyLocal(namespace: string, name: string, mtimeMs: number) {
  const p = join(root, 'local-agent-mode-sessions', namespace, name)
  await mkdir(join(p, '..'), { recursive: true })
  await writeFile(p, JSON.stringify({ sessionId: name, cliSessionId: name.replace(/^local_/, '').replace(/\.json$/, '') }))
  const when = new Date(mtimeMs)
  await utimes(p, when, when)
  return p
}

describe('ClaudeDesktopSessionRepair.preview', () => {
  it('选择最新 code namespace 为当前空间，并统计缺失索引', async () => {
    await writeLocal('old-account/old-workspace', 'local_old.json', 1_000)
    await writeLocal('old-account/old-workspace', 'local_existing.json', 2_000)
    await writeLocal('new-account/new-workspace', 'local_existing.json', 3_000)
    await writeLocal('new-account/new-workspace', 'local_new.json', 9_000)

    const pv = await repair().preview()

    expect(pv.available).toBe(true)
    expect(pv.currentNamespace?.key).toBe('new-account/new-workspace')
    expect(pv.sourceNamespaces.map((n) => n.key)).toEqual(['old-account/old-workspace'])
    expect(pv.repairable).toBe(1)
    expect(pv.namespaces.find((n) => n.key === 'old-account/old-workspace')?.codeSessionCount).toBe(2)
  })

  it('把旧版 local-agent 空间作为可修复来源', async () => {
    await writeLegacyLocal('old-account/old-workspace', 'local_legacy.json', 1_000)
    await writeLocal('new-account/new-workspace', 'local_new.json', 9_000)

    const pv = await repair().preview()

    expect(pv.currentNamespace?.key).toBe('new-account/new-workspace')
    expect(pv.sourceNamespaces.map((n) => n.key)).toEqual(['old-account/old-workspace'])
    expect(pv.repairable).toBe(1)
  })
})

describe('ClaudeDesktopSessionRepair.repair', () => {
  it('只复制目标空间缺失的 local 索引，并可回滚本次复制', async () => {
    await writeLocal('old-account/old-workspace', 'local_missing.json', 1_000)
    await writeLocal('old-account/old-workspace', 'local_existing.json', 2_000)
    await writeLocal('new-account/new-workspace', 'local_existing.json', 9_000)

    const svc = repair()
    const res = await svc.repair({
      targetNamespace: 'new-account/new-workspace',
      sourceNamespaces: ['old-account/old-workspace'],
    })

    const copied = join(root, 'claude-code-sessions', 'new-account/new-workspace', 'local_missing.json')
    const existing = join(root, 'claude-code-sessions', 'new-account/new-workspace', 'local_existing.json')
    expect(res.copied).toBe(1)
    expect(res.skippedExisting).toBe(1)
    expect(existsSync(copied)).toBe(true)
    expect(existsSync(existing)).toBe(true)

    await svc.rollback(res.backupId)

    expect(existsSync(copied)).toBe(false)
    expect(existsSync(existing)).toBe(true)
  })

  it('从旧版 local-agent 同空间复制缺失索引到 code sessions', async () => {
    await writeLocal('same-account/same-workspace', 'local_existing.json', 9_000)
    await writeLegacyLocal('same-account/same-workspace', 'local_missing.json', 1_000)

    const svc = repair()
    const res = await svc.repair()

    const copied = join(root, 'claude-code-sessions', 'same-account/same-workspace', 'local_missing.json')
    expect(res.targetNamespace).toBe('same-account/same-workspace')
    expect(res.sourceNamespaces).toEqual(['same-account/same-workspace'])
    expect(res.copied).toBe(1)
    expect(existsSync(copied)).toBe(true)
  })

  it('拒绝包含路径穿越片段的 renderer supplied namespace', async () => {
    await writeLocal('target-account/target-workspace', 'local_existing.json', 9_000)
    await writeLocal('source-account/source-workspace', 'local_missing.json', 1_000)

    const svc = repair()

    await expect(svc.repair({
      targetNamespace: '../escaped',
      sourceNamespaces: ['source-account/source-workspace'],
    })).rejects.toThrow('无效的 Claude Desktop 会话空间')
    await expect(svc.repair({
      targetNamespace: 'target-account/target-workspace',
      sourceNamespaces: ['source-account/..'],
    })).rejects.toThrow('无效的 Claude Desktop 会话空间')
    await expect(svc.repair({
      targetNamespace: 'target-account/work\\space',
      sourceNamespaces: ['source-account/source-workspace'],
    })).rejects.toThrow('无效的 Claude Desktop 会话空间')
  })
})
