import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  normalizeGlobalState,
  countGlobalStateUpdates,
  applyGlobalStateUpdate,
} from '../../../src/main/contexts/sessions/infrastructure/codex-global-state'

let dir: string
beforeEach(async () => { dir = await mkdtemp(join(tmpdir(), 'hxg-global-state-')) })
afterEach(async () => { await rm(dir, { recursive: true, force: true }) })

// ─── normalizeGlobalState ─────────────────────────────────────────────────────

describe('normalizeGlobalState', () => {
  it('electron-saved-workspace-roots: 去重', () => {
    const state = {
      'electron-saved-workspace-roots': [
        '/Users/foo/bar',
        '/Users/foo/bar',     // duplicate
        '/Users/foo/baz',
      ],
    }
    const result = normalizeGlobalState(state)
    expect(result['electron-saved-workspace-roots']).toEqual([
      '/Users/foo/bar',
      '/Users/foo/baz',
    ])
  })

  it('project-order: 去重', () => {
    const state = {
      'project-order': ['/a', '/a', '/b'],
    }
    const result = normalizeGlobalState(state)
    expect(result['project-order']).toEqual(['/a', '/b'])
  })

  it('active-workspace-roots: 数组时去重后保持数组', () => {
    const state = {
      'active-workspace-roots': ['/x', '/x', '/y'],
    }
    const result = normalizeGlobalState(state)
    expect(Array.isArray(result['active-workspace-roots'])).toBe(true)
    expect(result['active-workspace-roots']).toEqual(['/x', '/y'])
  })

  it('active-workspace-roots: 标量字符串时保持标量(取首项)', () => {
    const state = {
      'active-workspace-roots': '/single',
    }
    const result = normalizeGlobalState(state)
    // non-array: result should be a scalar (the first deduped path)
    expect(typeof result['active-workspace-roots']).toBe('string')
    expect(result['active-workspace-roots']).toBe('/single')
  })

  it('不存在的键不产出', () => {
    const state = {
      'electron-saved-workspace-roots': ['/a'],
    }
    const result = normalizeGlobalState(state)
    expect(Object.keys(result)).toEqual(['electron-saved-workspace-roots'])
    // Keys that were not in input are not in output
    expect('electron-workspace-root-labels' in result).toBe(false)
    expect('open-in-target-preferences' in result).toBe(false)
    expect('project-order' in result).toBe(false)
    expect('active-workspace-roots' in result).toBe(false)
  })

  it('electron-workspace-root-labels: 键经 toDesktopWorkspacePath 规范', () => {
    const state = {
      'electron-workspace-root-labels': {
        '  /Users/foo/bar  ': 'My Project',  // trimmed in toDesktopWorkspacePath
        '/Users/foo/baz': 'Another',
      },
    }
    const result = normalizeGlobalState(state)
    const labels = result['electron-workspace-root-labels'] as Record<string, unknown>
    expect(labels['/Users/foo/bar']).toBe('My Project')
    expect(labels['/Users/foo/baz']).toBe('Another')
  })

  it('open-in-target-preferences: perPath 键经规范', () => {
    const state = {
      'open-in-target-preferences': {
        defaultTarget: 'vscode',
        perPath: {
          '  /Users/foo  ': 'terminal',
        },
      },
    }
    const result = normalizeGlobalState(state)
    const openTargets = result['open-in-target-preferences'] as Record<string, unknown>
    expect(openTargets['defaultTarget']).toBe('vscode')
    const perPath = openTargets['perPath'] as Record<string, unknown>
    expect(perPath['/Users/foo']).toBe('terminal')
  })

  it('大小写不同但路径相同的重复项去重', () => {
    // macOS paths are case-insensitive; dedup should handle this
    const state = {
      'electron-saved-workspace-roots': [
        '/Users/Foo/Bar',
        '/users/foo/bar',
      ],
    }
    const result = normalizeGlobalState(state)
    // Should deduplicate to just the first item
    expect((result['electron-saved-workspace-roots'] as string[]).length).toBe(1)
  })
})

// ─── countGlobalStateUpdates ──────────────────────────────────────────────────

describe('countGlobalStateUpdates', () => {
  it('有变更键时返回变更数', async () => {
    const p = join(dir, '.codex-global-state.json')
    const state = {
      'electron-saved-workspace-roots': ['/a', '/a', '/b'],
    }
    await writeFile(p, JSON.stringify(state))
    const count = await countGlobalStateUpdates(p)
    expect(count).toBe(1) // electron-saved-workspace-roots changed (deduped)
  })

  it('无变更时返回 0', async () => {
    const p = join(dir, '.codex-global-state.json')
    const state = {
      'electron-saved-workspace-roots': ['/a', '/b'],  // already deduped
    }
    await writeFile(p, JSON.stringify(state))
    const count = await countGlobalStateUpdates(p)
    expect(count).toBe(0)
  })

  it('文件不存在时返回 0', async () => {
    const p = join(dir, '.codex-global-state.json')
    const count = await countGlobalStateUpdates(p)
    expect(count).toBe(0)
  })
})

// ─── applyGlobalStateUpdate ───────────────────────────────────────────────────

describe('applyGlobalStateUpdate', () => {
  it('有变更时写入 path 并同写 .bak，返回变更键数', async () => {
    const p = join(dir, '.codex-global-state.json')
    const state = {
      'electron-saved-workspace-roots': ['/a', '/a', '/b'],
      'project-order': ['/x', '/x'],
    }
    await writeFile(p, JSON.stringify(state))
    const count = await applyGlobalStateUpdate(p)
    expect(count).toBe(2)  // both keys changed

    const written = JSON.parse(await readFile(p, 'utf8'))
    expect(written['electron-saved-workspace-roots']).toEqual(['/a', '/b'])
    expect(written['project-order']).toEqual(['/x'])

    const bakPath = p + '.bak'
    expect(existsSync(bakPath)).toBe(true)
    const bak = JSON.parse(await readFile(bakPath, 'utf8'))
    expect(bak['electron-saved-workspace-roots']).toEqual(['/a', '/b'])
  })

  it('无变更时不写文件，返回 0', async () => {
    const p = join(dir, '.codex-global-state.json')
    const state = { 'electron-saved-workspace-roots': ['/a', '/b'] }
    await writeFile(p, JSON.stringify(state))

    const mtimeBefore = (await import('node:fs')).statSync(p).mtimeMs
    const count = await applyGlobalStateUpdate(p)
    expect(count).toBe(0)
    const mtimeAfter = (await import('node:fs')).statSync(p).mtimeMs
    expect(mtimeAfter).toBe(mtimeBefore)  // file not touched
  })

  it('文件不存在时返回 0 不报错', async () => {
    const p = join(dir, '.codex-global-state.json')
    await expect(applyGlobalStateUpdate(p)).resolves.toBe(0)
  })

  it('9 个真实 macOS 路径无重复时全部保留', async () => {
    const p = join(dir, '.codex-global-state.json')
    const roots = [
      '/Users/liuqin/project-a',
      '/Users/liuqin/project-b',
      '/Users/liuqin/project-c',
      '/Users/liuqin/project-d',
      '/Users/liuqin/project-e',
      '/Users/liuqin/project-f',
      '/Users/liuqin/project-g',
      '/Users/liuqin/project-h',
      '/Users/liuqin/project-i',
    ]
    await writeFile(p, JSON.stringify({ 'electron-saved-workspace-roots': roots }))
    const count = await applyGlobalStateUpdate(p)
    expect(count).toBe(0)  // all unique, no changes
    const written = JSON.parse(await readFile(p, 'utf8'))
    expect(written['electron-saved-workspace-roots']).toEqual(roots)
  })
})
