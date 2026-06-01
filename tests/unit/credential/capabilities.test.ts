import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createCipheriv, randomBytes } from 'node:crypto'
import Database from 'better-sqlite3'
import { CursorLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/cursor-local-import'
import { CodexLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/codex-local-import'
import { KiroLocalImportCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/kiro-local-import'
import { TokenExpiryValidationCapability } from '../../../src/main/contexts/credential/infrastructure/capabilities/token-expiry-validation'
import { CryptoService } from '../../../src/main/platform/crypto/crypto-service'
import { buildAad, type StoredEnvelope } from '../../../src/main/contexts/credential/domain/envelope'
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

describe('KiroLocalImportCapability', () => {
  // Kiro reads ~/.aws/sso/cache/kiro-auth-token.json (plain JSON), NOT a VSCode
  // SecretStorage secret:// blob. These mirror the real on-disk shape.
  function writeAuthToken(obj: Record<string, unknown>): string {
    const p = join(tmp, 'kiro-auth-token.json')
    writeFileSync(p, JSON.stringify(obj))
    return p
  }
  function writeProfile(obj: Record<string, unknown>): string {
    const p = join(tmp, 'profile.json')
    writeFileSync(p, JSON.stringify(obj))
    return p
  }

  it('reads accessToken/refreshToken/email/expiresAt from the AWS SSO token file', async () => {
    const authPath = writeAuthToken({
      accessToken: 'kiro-access',
      refreshToken: 'kiro-refresh',
      email: 'kiro@example.com',
      userId: 'kiro-user-id',
      loginProvider: 'Google',
      expiresAt: '2026-12-31T00:00:00.000Z',
    })
    const profilePath = writeProfile({ email: 'kiro@example.com', userId: 'kiro-user-id', loginProvider: 'Google' })
    const usageDb = makeStateVscdb({ 'kiro.kiroAgent': JSON.stringify({ usage: 42 }) })

    const cap = new KiroLocalImportCapability(authPath, profilePath, usageDb)
    const materials = await cap.scanLocal()
    expect(materials).toHaveLength(1)
    const m = materials[0]
    expect(m.provider).toBe('kiro')
    expect(m.accessToken).toBe('kiro-access')
    expect(m.refreshToken).toBe('kiro-refresh')
    expect(m.email).toBe('kiro-user-id') // profile userId wins per source pick order
    expect(m.source).toBe('local_scan')
    expect(m.expiresAt?.toISOString()).toBe('2026-12-31T00:00:00.000Z')
    const meta = m.rawMetadata as Record<string, unknown>
    expect(meta.login_provider).toBe('Google')
    expect((meta.kiro_usage_raw as Record<string, unknown>).usage).toBe(42)
    expect((meta.kiro_auth_token_raw as Record<string, unknown>).accessToken).toBe('kiro-access')
  })

  it('throws InvalidCredential when the token file has no accessToken', async () => {
    const authPath = writeAuthToken({ refreshToken: 'r', email: 'e@x.com' })
    const cap = new KiroLocalImportCapability(authPath, join(tmp, 'no-profile.json'), join(tmp, 'no.vscdb'))
    await expect(cap.scanLocal()).rejects.toMatchObject({ kind: 'invalid_credential' })
  })

  it('returns empty when the token file is absent', async () => {
    const cap = new KiroLocalImportCapability(join(tmp, 'missing.json'), join(tmp, 'p.json'), join(tmp, 'db.vscdb'))
    expect(await cap.scanLocal()).toEqual([])
  })

  it('falls back to auth-token email when profile is missing', async () => {
    const authPath = writeAuthToken({ accessToken: 'a', email: 'fallback@example.com' })
    const cap = new KiroLocalImportCapability(authPath, join(tmp, 'no-profile.json'), join(tmp, 'no.vscdb'))
    const m = (await cap.scanLocal())[0]
    expect(m.email).toBe('fallback@example.com')
    expect(m.refreshToken).toBeUndefined()
  })
})

describe('TokenExpiryValidationCapability', () => {
  const key = randomBytes(32)
  const crypto = new CryptoService(key)
  const aad = buildAad('kiro', 'acc-1', '2026-05-31T00:00:00.000Z')

  function envelopeFor(cred: { token: string; refresh_token?: string; expires_at?: string }): StoredEnvelope {
    return { aad, envelope: crypto.encrypt(JSON.stringify(cred), aad) }
  }

  it('reports the provider it was constructed with', () => {
    expect(new TokenExpiryValidationCapability('cursor', crypto).provider()).toBe('cursor')
    expect(new TokenExpiryValidationCapability('github_copilot', crypto).provider()).toBe('github_copilot')
  })

  it('reports valid when the token is unexpired', async () => {
    const env = envelopeFor({ token: 'at', expires_at: '2999-01-01T00:00:00.000Z' })
    const r = await new TokenExpiryValidationCapability('kiro', crypto).validate(env)
    expect(r.state).toBe('valid')
  })

  it('reports valid for a credential with no expiry (e.g. API keys)', async () => {
    const env = envelopeFor({ token: 'at' })
    const r = await new TokenExpiryValidationCapability('cursor', crypto).validate(env)
    expect(r.state).toBe('valid')
  })

  it('reports valid when expired but a refresh token exists (auto-refreshes)', async () => {
    const env = envelopeFor({ token: 'at', refresh_token: 'rt', expires_at: '2000-01-01T00:00:00.000Z' })
    const r = await new TokenExpiryValidationCapability('windsurf', crypto).validate(env)
    expect(r.state).toBe('valid')
  })

  it('reports expired when expired and no refresh token', async () => {
    const env = envelopeFor({ token: 'at', expires_at: '2000-01-01T00:00:00.000Z' })
    const r = await new TokenExpiryValidationCapability('qoder', crypto).validate(env)
    expect(r.state).toBe('expired')
  })

  it('reports unknown_error when the envelope cannot be decrypted (wrong key)', async () => {
    const env = envelopeFor({ token: 'at' })
    const otherKey = new CryptoService(randomBytes(32))
    const r = await new TokenExpiryValidationCapability('kiro', otherKey).validate(env)
    expect(r.state).toBe('unknown_error')
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
