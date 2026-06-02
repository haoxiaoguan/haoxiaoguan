import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { detectAppPath } from '../../../src/main/platform/identity/app-paths'

// app-paths probes the real filesystem for OS-specific install locations. We
// can't write to /Applications, so these tests assert the OS-aware *suggestion*
// (deterministic, no disk) and the unknown-platform contract. The "detected"
// path is environment-dependent and only asserted to be null-or-existing.
describe('detectAppPath', () => {
  it('returns a platform+OS-appropriate suggestion for known platforms', () => {
    const info = detectAppPath('kiro')
    expect(typeof info.suggestion).toBe('string')
    expect(info.suggestion.length).toBeGreaterThan(0)
    if (process.platform === 'darwin') {
      expect(info.suggestion).toBe('/Applications/Kiro.app')
    } else if (process.platform === 'win32') {
      expect(info.suggestion.toLowerCase()).toContain('kiro.exe')
    } else {
      expect(info.suggestion).toContain('kiro')
    }
  })

  it('accepts kebab frontend ids (gemini-cli, codebuddy-cn)', () => {
    // gemini-cli has no app candidates (CLI) → empty suggestion, never throws.
    expect(detectAppPath('gemini-cli')).toEqual({ detected: null, suggestion: '' })
    // codebuddy-cn is a known multi-word kebab id with candidates.
    const cn = detectAppPath('codebuddy-cn')
    if (process.platform === 'darwin') {
      expect(cn.suggestion).toBe('/Applications/CodeBuddyCN.app')
    }
  })

  it('returns a neutral result for an unknown platform', () => {
    expect(detectAppPath('not-a-platform')).toEqual({ detected: null, suggestion: '' })
  })

  it('detects an existing macOS bundle when present', () => {
    if (process.platform !== 'darwin') return
    // We can't create /Applications/Kiro.app in CI, so just assert the contract:
    // detected is either null or an existing path equal to the suggestion.
    const info = detectAppPath('kiro')
    if (info.detected !== null) {
      expect(info.detected).toBe(info.suggestion)
    }
  })
})

// Cross-platform sanity: a fabricated candidate that DOES exist is detected.
// We exercise the existence check indirectly via a temp dir on linux-style
// absolute paths is not possible (candidates are hard-coded), so this block
// only documents intent; the real coverage is the suggestion + contract above.
describe('detectAppPath (temp-dir smoke)', () => {
  let dir: string
  beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'apppath-')) })
  afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

  it('creates and removes a temp dir without affecting detection', () => {
    mkdirSync(join(dir, 'Fake.app'))
    // Unknown platform stays neutral regardless of unrelated dirs on disk.
    expect(detectAppPath('unknown')).toEqual({ detected: null, suggestion: '' })
  })
})
