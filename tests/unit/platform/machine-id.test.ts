import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const MODULE = '../../../src/main/platform/identity/machine-id'

// machine-id caches per-module, so reset the module registry per test to
// exercise the generate-and-persist path. HXG_USER_DATA_DIR points appDataDir
// at a temp dir.
describe('getMachineId', () => {
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
})
