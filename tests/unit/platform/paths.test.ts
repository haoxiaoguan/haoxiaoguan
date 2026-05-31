import { describe, it, expect } from 'vitest'
import { appDataDir, appSupportDir, dotDir } from '../../../src/main/platform/persistence/paths'

describe('paths', () => {
  it('appSupportDir builds an OS-specific path ending in the app name', () => {
    const p = appSupportDir('Cursor')
    expect(p.endsWith('Cursor')).toBe(true)
    expect(p.length).toBeGreaterThan('Cursor'.length)
  })

  it('dotDir returns a home-relative dotfile path', () => {
    const p = dotDir('codex')
    expect(p.endsWith('.codex') || p.endsWith('codex')).toBe(true)
  })

  it('appDataDir returns the haoxiaoguan data directory', () => {
    expect(appDataDir().toLowerCase()).toContain('haoxiaoguan')
  })
})
