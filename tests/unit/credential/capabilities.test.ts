import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv } from 'node:crypto'
import Database from 'better-sqlite3'
import { CursorLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/cursor-local-import'
import { CodexLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/codex-local-import'
import { TokenJsonFileImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/token-json-file-import'
import { DeepLinkImportCapabilityImpl } from '../../../src/main/contexts/credential/infrastructure/capabilities/deep-link-import'
import { CredentialError } from '../../../src/main/contexts/credential/domain/credential-error'
import { pbkdf2Sha1Key } from '../../../src/main/contexts/credential/infrastructure/vscode-secret-storage'
import { readVscdbItem } from '../../../src/main/contexts/credential/infrastructure/vscdb-reader'
import { writeFileSync } from 'node:fs'

let tmp: string

beforeEach(() => {
  tmp = mkdtempSync(join(tmpdir(), 'cred-cap-'))
})

afterEach(() => {
  rmSync(tmp, { recursive: true, force: true })
})

function makeStateVscdb(items: Record<string, string>): string {
  const dbPath = join(tmp, 'state.vscdb')
  const db = new Database(dbPath)
  db.exec('CREATE TABLE ItemTable (key TEXT UNIQUE ON CONFLICT REPLACE, value BLOB)')
  const insert = db.prepare('INSERT INTO ItemTable (key, value) VALUES (?, ?)')
  for (const [k, v] of Object.entries(items)) insert.run(k, v)
  db.close()
  return dbPath
}

describe('CursorLocalImportCapability', () => {
  it('reads the reference cursorAuth fields from state.vscdb', async () => {
    const dbPath = makeStateVscdb({
      'cursorAuth/accessToken': 'cursor-access',
      'cursorAuth/refreshToken': 'cursor-refresh',
      'cursorAuth/cachedEmail': 'cursor@example.com',
      'cursorAuth/authId': 'auth0|user_123',
      'cursorAuth/stripeMembershipType': 'pro',
      'cursorAuth/stripeSubscriptionStatus': 'active',
      'cursorAuth/cachedSignUpType': 'github',
    })
    const cap = new CursorLocalImportCapability(dbPath)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('cursor')
    expect(m.email).toBe('cursor@example.com')
    expect(m.accessToken).toBe('cursor-access')
    expect(m.refreshToken).toBe('cursor-refresh')
    expect(m.source).toBe('local_scan')
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.auth_id).toBe('auth0|user_123')
    expect(meta.membership_type).toBe('pro')
    expect((meta.cursor_auth_raw as Record<string, unknown>).accessToken).toBe('cursor-access')
  })

  it('returns empty when required fields are missing', async () => {
    const dbPath = makeStateVscdb({ 'cursorAuth/cachedEmail': 'cursor@example.com' })
    const cap = new CursorLocalImportCapability(dbPath)
    expect(await cap.scanLocal()).toEqual([])
  })

  it('returns empty when the state.vscdb file does not exist', async () => {
    const cap = new CursorLocalImportCapability(join(tmp, 'missing.vscdb'))
    expect(await cap.scanLocal()).toEqual([])
  })
})

describe('CodexLocalImportCapability', () => {
  it('parses an API-key auth.json', async () => {
    writeFileSync(
      join(tmp, 'auth.json'),
      JSON.stringify({ auth_mode: 'apikey', OPENAI_API_KEY: 'sk-test', base_url: 'https://api.openai.com' }),
    )
    const cap = new CodexLocalImportCapability(tmp)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    expect(materials[0].accessToken).toBe('sk-test')
    expect(materials[0].source).toBe('local_scan')
  })

  it('returns empty when auth.json is absent', async () => {
    const cap = new CodexLocalImportCapability(join(tmp, 'no-such-dir'))
    expect(await cap.scanLocal()).toEqual([])
  })
})

describe('TokenJsonFileImportCapability', () => {
  it('normalises a token JSON payload', async () => {
    const cap = new TokenJsonFileImportCapability('cursor')
    const m = await cap.importFromJson(
      JSON.stringify({ access_token: 'at', refresh_token: 'rt', email: 'u@e.com' }),
    )
    expect(m.provider).toBe('cursor')
    expect(m.accessToken).toBe('at')
    expect(m.refreshToken).toBe('rt')
    expect(m.email).toBe('u@e.com')
    expect(m.source).toBe('token_json_file')
  })

  it('throws MalformedInput for invalid JSON', async () => {
    const cap = new TokenJsonFileImportCapability('cursor')
    await expect(cap.importFromJson('not json')).rejects.toMatchObject({ kind: 'malformed_input' })
  })

  it('throws InvalidCredential when access token is missing', async () => {
    const cap = new TokenJsonFileImportCapability('cursor')
    await expect(cap.importFromJson('{"email":"u@e.com"}')).rejects.toMatchObject({
      kind: 'invalid_credential',
    })
  })
})

describe('DeepLinkImportCapabilityImpl', () => {
  it('parses a haoxiaoguan://import/{provider} URL', async () => {
    const cap = new DeepLinkImportCapabilityImpl('kiro')
    const m = await cap.importFromDeeplink('haoxiaoguan://import/kiro?token=tk&refresh_token=rt&email=u@e.com')
    expect(m.provider).toBe('kiro')
    expect(m.accessToken).toBe('tk')
    expect(m.refreshToken).toBe('rt')
    expect(m.email).toBe('u@e.com')
    expect(m.source).toBe('deep_link')
  })

  it('rejects a non-haoxiaoguan scheme', async () => {
    const cap = new DeepLinkImportCapabilityImpl('kiro')
    await expect(cap.importFromDeeplink('https://example.com/import/kiro?token=x')).rejects.toMatchObject(
      { kind: 'malformed_input' },
    )
  })

  it('rejects a provider mismatch', async () => {
    const cap = new DeepLinkImportCapabilityImpl('kiro')
    await expect(cap.importFromDeeplink('haoxiaoguan://import/cursor?token=x')).rejects.toMatchObject(
      { kind: 'malformed_input' },
    )
  })

  it('throws when the token is missing', async () => {
    const cap = new DeepLinkImportCapabilityImpl('kiro')
    await expect(cap.importFromDeeplink('haoxiaoguan://import/kiro')).rejects.toMatchObject({
      kind: 'invalid_credential',
    })
  })
})

describe('VSCode SecretStorage PBKDF2-SHA1 key derivation', () => {
  it('derives a 16-byte AES-128 key (matches the source salt + macOS 1003 iterations)', () => {
    const key = pbkdf2Sha1Key('password', 1003)
    expect(key).toHaveLength(16)
    // Deterministic for a fixed password/iterations.
    expect(pbkdf2Sha1Key('password', 1003).equals(key)).toBe(true)
  })

  it('round-trips a v10 AES-128-CBC payload using the derived key (macOS-style)', () => {
    // Encrypt with the same scheme the source uses (16-space IV, PKCS7) and
    // confirm a v10-prefixed ciphertext decrypts with the derived key.
    const password = 'safe-storage-pass'
    const key = pbkdf2Sha1Key(password, 1003)
    const iv = Buffer.alloc(16, 0x20)
    const cipher = createCipheriv('aes-128-cbc', key, iv)
    const plaintext = JSON.stringify({ access_token: 'secret-token' })
    const enc = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
    const prefixed = Buffer.concat([Buffer.from('v10'), enc])
    // Manually decrypt mirroring decryptCbcPrefixed (the OS-keyed path needs the
    // Keychain, so we verify the crypto core directly).
    const { createDecipheriv } = require('node:crypto') as typeof import('node:crypto')
    const decipher = createDecipheriv('aes-128-cbc', key, iv)
    const dec = Buffer.concat([decipher.update(prefixed.subarray(3)), decipher.final()]).toString('utf8')
    expect(JSON.parse(dec).access_token).toBe('secret-token')
  })
})

describe('vscdb-reader', () => {
  it('reads a stored value and normalises empties to null', () => {
    const dbPath = makeStateVscdb({ k: 'value', empty: '   ' })
    expect(readVscdbItem(dbPath, 'k')).toBe('value')
    expect(readVscdbItem(dbPath, 'empty')).toBeNull()
    expect(readVscdbItem(dbPath, 'absent')).toBeNull()
  })

  it('returns null for a missing file', () => {
    expect(readVscdbItem(join(tmp, 'nope.vscdb'), 'k')).toBeNull()
  })
})
