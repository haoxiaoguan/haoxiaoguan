import { describe, it, expect } from 'vitest'
import { Credential } from '../../../src/main/contexts/credential/domain/credential'
import { CredentialError } from '../../../src/main/contexts/credential/domain/credential-error'
import {
  importedMaterialToJson,
  oauthPendingToJson,
  parseOAuthMode,
  validationResultToJson,
  validNow,
  unsupportedNow,
  type ImportedCredentialMaterial,
  type OAuthPending,
} from '../../../src/main/contexts/credential/domain/capability-types'

describe('Credential value object', () => {
  it('is not expired when expiresAt is undefined', () => {
    expect(new Credential('tok').isExpired()).toBe(false)
  })

  it('is expired when expiresAt is in the past', () => {
    const past = new Date(Date.now() - 60_000)
    expect(new Credential('tok', undefined, past).isExpired()).toBe(true)
  })

  it('round-trips through snake_case JSON', () => {
    const expires = new Date('2026-01-01T00:00:00.000Z')
    const c = new Credential('tok', 'rt', expires, { extra: 1 })
    const json = c.toJson()
    expect(json).toEqual({
      token: 'tok',
      refresh_token: 'rt',
      expires_at: '2026-01-01T00:00:00.000Z',
      raw_metadata: { extra: 1 },
    })
    const back = Credential.fromJson(json)
    expect(back.token).toBe('tok')
    expect(back.refreshToken).toBe('rt')
    expect(back.expiresAt?.toISOString()).toBe(expires.toISOString())
  })

  it('omits optional fields when undefined', () => {
    expect(new Credential('only').toJson()).toEqual({ token: 'only' })
  })
})

describe('CredentialError', () => {
  it('formats invalidCredential message like the source', () => {
    const e = CredentialError.invalidCredential('missing access_token')
    expect(e.kind).toBe('invalid_credential')
    expect(e.message).toBe('invalid credential: missing access_token')
  })

  it('formats unsupportedSource with provider agent id + method', () => {
    const e = CredentialError.unsupportedSource('github_copilot', 'oauth')
    expect(e.kind).toBe('unsupported_source')
    expect(e.message).toBe('unsupported source: provider=github_copilot, method=oauth')
    expect(e.data).toMatchObject({ provider: 'github_copilot', method: 'oauth' })
  })

  it('formats oauthPortInUse with the port', () => {
    const e = CredentialError.oauthPortInUse(3128)
    expect(e.kind).toBe('oauth_port_in_use')
    expect(e.message).toBe('oauth port 3128 already in use')
    expect(e.data.port).toBe(3128)
  })

  it('formats importConflict with the existing id', () => {
    const e = CredentialError.importConflict('abc-123')
    expect(e.message).toBe('import conflict: existing account abc-123')
  })

  it('is an instanceof Error and CredentialError', () => {
    const e = CredentialError.internal('boom')
    expect(e).toBeInstanceOf(Error)
    expect(e).toBeInstanceOf(CredentialError)
  })
})

describe('capability-types JSON helpers', () => {
  it('parseOAuthMode accepts the two valid modes', () => {
    expect(parseOAuthMode('loopback_pkce')).toBe('loopback_pkce')
    expect(parseOAuthMode('deep_link')).toBe('deep_link')
    expect(() => parseOAuthMode('nope')).toThrow(/Unknown OAuth mode/)
  })

  it('oauthPendingToJson strips state + code_verifier and uses snake_case', () => {
    const pending: OAuthPending = {
      pendingId: 'p1',
      authorizeUrl: 'https://example.com/auth',
      redirectPath: '/oauth/callback',
      boundPort: 3128,
      state: 'secret-state',
      codeVerifier: 'secret-verifier',
    }
    const json = oauthPendingToJson(pending)
    expect(json).toEqual({
      pending_id: 'p1',
      authorize_url: 'https://example.com/auth',
      redirect_path: '/oauth/callback',
      bound_port: 3128,
    })
    expect(JSON.stringify(json)).not.toContain('secret')
  })

  it('oauthPendingToJson omits bound_port when undefined', () => {
    const json = oauthPendingToJson({
      pendingId: 'p',
      authorizeUrl: 'u',
      redirectPath: '/x',
      state: '',
      codeVerifier: '',
    })
    expect(json).not.toHaveProperty('bound_port')
  })

  it('importedMaterialToJson omits optional fields and uses snake_case', () => {
    const m: ImportedCredentialMaterial = {
      provider: 'kiro',
      email: 'u@e.com',
      accessToken: 'tok',
      source: 'oauth',
    }
    const json = importedMaterialToJson(m)
    expect(json).toEqual({
      provider: 'kiro',
      email: 'u@e.com',
      access_token: 'tok',
      source: 'oauth',
    })
    expect(json).not.toHaveProperty('refresh_token')
    expect(json).not.toHaveProperty('expires_at')
  })

  it('importedMaterialToJson includes optional fields when present', () => {
    const m: ImportedCredentialMaterial = {
      provider: 'github_copilot',
      email: 'u@e.com',
      accessToken: 'tok',
      refreshToken: 'rt',
      expiresAt: new Date('2026-01-01T00:00:00.000Z'),
      source: 'local_scan',
      rawMetadata: { a: 1 },
    }
    const json = importedMaterialToJson(m)
    expect(json.provider).toBe('github_copilot')
    expect(json.refresh_token).toBe('rt')
    expect(json.expires_at).toBe('2026-01-01T00:00:00.000Z')
    expect(json.raw_metadata).toEqual({ a: 1 })
  })

  it('validationResultToJson uses snake_case and omits optional fields', () => {
    const checked = new Date('2026-01-01T00:00:00.000Z')
    expect(validationResultToJson({ state: 'valid', checkedAt: checked })).toEqual({
      state: 'valid',
      checked_at: '2026-01-01T00:00:00.000Z',
    })
  })

  it('validNow / unsupportedNow produce the right state', () => {
    expect(validNow().state).toBe('valid')
    expect(unsupportedNow().state).toBe('unsupported')
  })
})
