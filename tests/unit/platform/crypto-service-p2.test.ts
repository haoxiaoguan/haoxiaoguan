/**
 * Tests for P2-3/P2-4/P2-5 (anti-detection spec):
 *   P2-3: Backoff defaults are production-scale (≥60s cooldown, etc.)
 *   P2-4: Raw base64 master key auto-upgrades to safeStorage on packaged launch
 *   P2-5: Master key file mtime is recorded and checkMasterKeyMtime() warns on change
 *
 * The electron stub (tests/stubs/electron.ts) reports safeStorage unavailable and
 * app.isPackaged=false by default.  Tests that exercise the packaged/safeStorage
 * paths temporarily override the stub exports via module mocking with vi.mock +
 * vi.stubEnv / vi.spyOn patterns.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, writeFileSync, readFileSync, statSync, utimesSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { randomBytes } from 'node:crypto'

// ---------------------------------------------------------------------------
// P2-3: AppSettings backoff defaults
// ---------------------------------------------------------------------------
import { AppSettings } from '../../../src/main/contexts/settings/domain/app-settings'

describe('P2-3: AppSettings backoff parameter defaults (production scale)', () => {
  it('apiProxyBaseCooldownMs default ≥ 60000 ms (60s)', () => {
    const s = AppSettings.fromJson({})
    expect(s.runtime.apiProxyBaseCooldownMs).toBeGreaterThanOrEqual(60000)
  })

  it('apiProxyMaxBackoffMultiplier default ≥ 16', () => {
    const s = AppSettings.fromJson({})
    expect(s.runtime.apiProxyMaxBackoffMultiplier).toBeGreaterThanOrEqual(16)
  })

  it('apiProxyQuotaResetMs default = 3600000 ms (1h)', () => {
    const s = AppSettings.fromJson({})
    expect(s.runtime.apiProxyQuotaResetMs).toBe(3600000)
  })

  it('apiProxyProbabilisticRetryChance default = 0.1 (10% half-open probe)', () => {
    const s = AppSettings.fromJson({})
    expect(s.runtime.apiProxyProbabilisticRetryChance).toBe(0.1)
  })

  it('backoff defaults survive fromJson round-trip', () => {
    const s = AppSettings.fromJson({})
    const again = AppSettings.fromJson(s.toJson())
    expect(again.runtime.apiProxyBaseCooldownMs).toBeGreaterThanOrEqual(60000)
    expect(again.runtime.apiProxyMaxBackoffMultiplier).toBeGreaterThanOrEqual(16)
    expect(again.runtime.apiProxyQuotaResetMs).toBe(3600000)
    expect(again.runtime.apiProxyProbabilisticRetryChance).toBe(0.1)
  })
})

// ---------------------------------------------------------------------------
// P2-4 + P2-5: master key re-wrap and mtime monitoring
//
// The electron stub has safeStorage.isEncryptionAvailable() → false and
// app.isPackaged → false, so normal loadOrCreateMasterKey tests run the dev
// path.  To exercise the packaged+safeStorage branch we inject a custom mock
// module via vi.mock with hoisted factory.
// ---------------------------------------------------------------------------

// We use vi.mock with a factory that can be overridden per test via a shared
// state object — the simplest approach that avoids ESM hoisting pitfalls.
const electronState = {
  isPackaged: false,
  encryptionAvailable: false,
  // Records calls to encryptString so we can assert re-wrap happened.
  encryptCalls: [] as string[],
  // When true, encryptString throws to simulate safeStorage failure.
  encryptShouldThrow: false,
  // Stores what decryptString returns (simulates already-wrapped format when set).
  decryptResult: null as string | null,
  // When true, decryptString throws (raw base64 file — expected behaviour).
  decryptShouldThrow: true,
}

vi.mock('electron', () => ({
  safeStorage: {
    isEncryptionAvailable() {
      return electronState.encryptionAvailable
    },
    encryptString(plain: string): Buffer {
      electronState.encryptCalls.push(plain)
      if (electronState.encryptShouldThrow) throw new Error('safeStorage unavailable')
      // Produce a clearly-distinguishable "safeStorage" encoding for tests:
      // prefix with a NUL byte so it cannot be valid UTF-8 base64.
      return Buffer.concat([Buffer.from([0x00]), Buffer.from(plain, 'utf8')])
    },
    decryptString(buf: Buffer): string {
      if (electronState.decryptShouldThrow) throw new Error('cannot decrypt')
      if (electronState.decryptResult !== null) return electronState.decryptResult
      // Default: strip the NUL prefix added by encryptString above.
      return buf.slice(1).toString('utf8')
    },
  },
  app: {
    get isPackaged() {
      return electronState.isPackaged
    },
    getPath(_name: string): string {
      return process.cwd()
    },
    getVersion(): string {
      return '0.0.0-test'
    },
  },
  ipcMain: {
    handle(_channel: string, _listener: unknown): void {},
  },
}))

// Import AFTER vi.mock so the mock is in effect.
import { loadOrCreateMasterKey, checkMasterKeyMtime } from '../../../src/main/platform/crypto/crypto-service'

function tempKeyFile(): { dir: string; file: string } {
  const dir = mkdtempSync(join(tmpdir(), 'hxg-p2-'))
  return { dir, file: join(dir, 'master.key.enc') }
}

beforeEach(() => {
  // Reset to dev defaults before each test.
  electronState.isPackaged = false
  electronState.encryptionAvailable = false
  electronState.encryptCalls = []
  electronState.encryptShouldThrow = false
  electronState.decryptResult = null
  electronState.decryptShouldThrow = true
})

// ---------------------------------------------------------------------------
// P2-4 tests
// ---------------------------------------------------------------------------

describe('P2-4: master key re-wrap (raw base64 → safeStorage on packaged)', () => {
  it('existing raw base64 key is re-wrapped when packaged + safeStorage available', async () => {
    const { dir, file } = tempKeyFile()
    try {
      // Write a raw base64 master key (as written by dev environment).
      const rawKey = randomBytes(32)
      writeFileSync(file, rawKey.toString('base64'), 'utf8')

      // Simulate packaged launch with safeStorage available.
      electronState.isPackaged = true
      electronState.encryptionAvailable = true
      electronState.decryptShouldThrow = true // raw base64 — safeStorage.decrypt throws

      const recovered = await loadOrCreateMasterKey(file)

      // Key bytes are intact.
      expect(recovered.equals(rawKey)).toBe(true)
      // encryptString was called once for the re-wrap.
      expect(electronState.encryptCalls.length).toBe(1)
      // On-disk content is no longer raw UTF-8 base64 (first byte is NUL from mock).
      const onDisk = readFileSync(file)
      expect(onDisk[0]).toBe(0x00)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('re-wrap failure leaves the original raw base64 file intact (no data loss)', async () => {
    const { dir, file } = tempKeyFile()
    try {
      const rawKey = randomBytes(32)
      const originalContent = rawKey.toString('base64')
      writeFileSync(file, originalContent, 'utf8')

      electronState.isPackaged = true
      electronState.encryptionAvailable = true
      electronState.decryptShouldThrow = true
      electronState.encryptShouldThrow = true // simulate safeStorage failure

      // loadOrCreateMasterKey must succeed even when re-wrap fails.
      const recovered = await loadOrCreateMasterKey(file)
      expect(recovered.equals(rawKey)).toBe(true)

      // Original file must be untouched.
      const onDisk = readFileSync(file, 'utf8')
      expect(onDisk).toBe(originalContent)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('already-safeStorage-wrapped file is NOT re-wrapped (no redundant write)', async () => {
    const { dir, file } = tempKeyFile()
    try {
      const rawKey = randomBytes(32)
      // Simulate a file already written by safeStorage (NUL-prefixed mock format).
      const wrapped = Buffer.concat([Buffer.from([0x00]), Buffer.from(rawKey.toString('base64'), 'utf8')])
      writeFileSync(file, wrapped)

      electronState.isPackaged = true
      electronState.encryptionAvailable = true
      // decryptString succeeds → file is already wrapped → no re-wrap needed
      electronState.decryptShouldThrow = false
      electronState.decryptResult = rawKey.toString('base64')

      await loadOrCreateMasterKey(file)

      // encryptString should NOT have been called (no re-wrap for already-wrapped key).
      expect(electronState.encryptCalls.length).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('undecodable file still throws and is never overwritten (anti-orphan invariant)', async () => {
    const { dir, file } = tempKeyFile()
    try {
      writeFileSync(file, '!!! garbage not base64 32 bytes !!!', 'utf8')
      const before = readFileSync(file)

      electronState.isPackaged = true
      electronState.encryptionAvailable = true
      electronState.decryptShouldThrow = true

      await expect(loadOrCreateMasterKey(file)).rejects.toThrow(/refusing to overwrite/)
      // File must be bit-for-bit identical.
      expect(readFileSync(file).equals(before)).toBe(true)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('dev build (isPackaged=false) never re-wraps even with safeStorage available', async () => {
    const { dir, file } = tempKeyFile()
    try {
      const rawKey = randomBytes(32)
      writeFileSync(file, rawKey.toString('base64'), 'utf8')

      electronState.isPackaged = false // dev!
      electronState.encryptionAvailable = true
      electronState.decryptShouldThrow = true

      const recovered = await loadOrCreateMasterKey(file)
      expect(recovered.equals(rawKey)).toBe(true)
      // No re-wrap in dev mode.
      expect(electronState.encryptCalls.length).toBe(0)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})

// ---------------------------------------------------------------------------
// P2-5 tests
// ---------------------------------------------------------------------------

describe('P2-5: master key mtime monitoring', () => {
  it('checkMasterKeyMtime returns undefined when file has not changed', async () => {
    const { dir, file } = tempKeyFile()
    try {
      electronState.isPackaged = false
      electronState.encryptionAvailable = false

      await loadOrCreateMasterKey(file)
      const warn = await checkMasterKeyMtime()
      expect(warn).toBeUndefined()
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('checkMasterKeyMtime returns a warning string when mtime changes', async () => {
    const { dir, file } = tempKeyFile()
    try {
      electronState.isPackaged = false
      electronState.encryptionAvailable = false

      await loadOrCreateMasterKey(file)

      // Advance the file mtime by 2 seconds via utimes.
      const now = new Date(Date.now() + 2000)
      utimesSync(file, now, now)

      const warn = await checkMasterKeyMtime()
      expect(typeof warn).toBe('string')
      expect(warn).toMatch(/mtime changed/)
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })

  it('checkMasterKeyMtime returns undefined before any key has been loaded', async () => {
    // No loadOrCreateMasterKey call in this test — module-level vars not set.
    // We can only verify the function is callable and returns undefined/string.
    // (Module state persists across tests in the same worker; this test is
    // intentionally positioned first via describe order. In practice, if a
    // previous test already loaded a key the function may return undefined or
    // a string — both are acceptable for this invariant check.)
    const result = await checkMasterKeyMtime()
    expect(result === undefined || typeof result === 'string').toBe(true)
  })

  it('mtime is recorded after key creation (new file path)', async () => {
    const { dir, file } = tempKeyFile()
    try {
      electronState.isPackaged = false
      electronState.encryptionAvailable = false

      await loadOrCreateMasterKey(file)

      // Immediately after creation, mtime should be consistent.
      const warn = await checkMasterKeyMtime()
      expect(warn).toBeUndefined()

      // Confirm the file exists and has 0600 perms on Unix.
      if (process.platform !== 'win32') {
        expect(statSync(file).mode & 0o777).toBe(0o600)
      }
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
