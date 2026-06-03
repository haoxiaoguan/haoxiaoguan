import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODULE = '../../../src/main/platform/identity/machine-id'

// machine-id caches per-module, so reset the module registry per test to
// exercise the generate-and-persist path. HXG_USER_DATA_DIR points appDataDir
// at a temp dir.
describe('getMachineId (no accountId — process-level singleton)', () => {
  let dir: string
  let prev: string | undefined

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'mid-'))
    prev = process.env.HXG_USER_DATA_DIR
    process.env.HXG_USER_DATA_DIR = dir
    vi.resetModules()
  })

  afterEach(() => {
    if (prev === undefined) delete process.env.HXG_USER_DATA_DIR
    else process.env.HXG_USER_DATA_DIR = prev
    rmSync(dir, { recursive: true, force: true })
  })

  it('generates a 64-char hex id, persists it, and returns it stably', async () => {
    const mod = await import(MODULE)
    const id = mod.getMachineId()
    expect(id).toMatch(/^[0-9a-f]{64}$/)
    const file = join(dir, 'machine.id')
    expect(existsSync(file)).toBe(true)
    expect(readFileSync(file, 'utf8').trim()).toBe(id)
    expect(mod.getMachineId()).toBe(id) // cached within the module
  })

  it('reuses an existing id across a fresh module load', async () => {
    const id1 = (await import(MODULE)).getMachineId()
    vi.resetModules()
    const id2 = (await import(MODULE)).getMachineId()
    expect(id2).toBe(id1)
  })

  it('writes machine.id with 0o600 permissions on Unix', async () => {
    if (process.platform === 'win32') return
    const mod = await import(MODULE)
    mod.getMachineId()
    const file = join(dir, 'machine.id')
    expect(existsSync(file)).toBe(true)
    const mode = statSync(file).mode & 0o777
    expect(mode).toBe(0o600)
  })
})

describe('getMachineId (with accountId — per-account isolation)', () => {
  it('returns a 64-char hex string', async () => {
    vi.resetModules()
    const mod = await import(MODULE)
    const id = mod.getMachineId('account-abc')
    expect(id).toMatch(/^[0-9a-f]{64}$/)
  })

  it('same accountId always returns the same value (stable across calls)', async () => {
    vi.resetModules()
    const mod = await import(MODULE)
    expect(mod.getMachineId('account-stable')).toBe(mod.getMachineId('account-stable'))
  })

  it('different accountIds produce different machineIds', async () => {
    vi.resetModules()
    const mod = await import(MODULE)
    expect(mod.getMachineId('account-A')).not.toBe(mod.getMachineId('account-B'))
  })

  it('per-account id is independent of (does not mutate) the process-level singleton', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mid-acct-'))
    const prev = process.env.HXG_USER_DATA_DIR
    process.env.HXG_USER_DATA_DIR = dir
    vi.resetModules()
    try {
      const mod = await import(MODULE)
      const processId = mod.getMachineId()           // seed the singleton
      const accountId = mod.getMachineId('account-X')
      expect(accountId).not.toBe(processId)
      // process-level singleton must remain unchanged
      expect(mod.getMachineId()).toBe(processId)
    } finally {
      if (prev === undefined) delete process.env.HXG_USER_DATA_DIR
      else process.env.HXG_USER_DATA_DIR = prev
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
