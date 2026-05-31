import { describe, it, expect, beforeEach } from 'vitest'
import { OAuthService } from '../../../src/main/contexts/credential/application/oauth-service'
import { ImportService } from '../../../src/main/contexts/credential/application/import-service'
import { ValidationService } from '../../../src/main/contexts/credential/application/validation-service'
import { ProviderRegistry } from '../../../src/main/contexts/credential/domain/provider-registry'
import { CredentialError } from '../../../src/main/contexts/credential/domain/credential-error'
import type {
  OAuthCapability,
  LocalImportCapability,
  FileImportCapability,
  DeepLinkImportCapability,
  CredentialValidationCapability,
} from '../../../src/main/contexts/credential/domain/capabilities'
import type {
  ImportedCredentialMaterial,
  OAuthMode,
  OAuthPending,
  CredentialValidationResult,
} from '../../../src/main/contexts/credential/domain/capability-types'
import type { PlatformId } from '../../../src/main/contexts/account/domain/platform-id'
import type {
  PendingOAuth,
  PendingOAuthRepository,
} from '../../../src/main/contexts/credential/domain/pending-repository'
import type { StoredEnvelope } from '../../../src/main/contexts/credential/domain/envelope'
import type { CredentialRepository } from '../../../src/main/contexts/credential/domain/credential-repository'
import { Credential } from '../../../src/main/contexts/credential/domain/credential'

// ---- in-memory pending repo ----
class InMemoryPendingOAuth implements PendingOAuthRepository {
  readonly rows = new Map<string, PendingOAuth>()
  async save(p: PendingOAuth): Promise<void> {
    this.rows.set(p.id, p)
  }
  async findById(id: string): Promise<PendingOAuth | null> {
    return this.rows.get(id) ?? null
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id)
  }
  async purgeExpired(now: Date): Promise<number> {
    let n = 0
    for (const [id, row] of this.rows) {
      if (row.expiresAt < now) {
        this.rows.delete(id)
        n++
      }
    }
    return n
  }
}

// ---- fake capabilities ----
class FakeOAuth implements OAuthCapability {
  constructor(private readonly p: PlatformId) {}
  provider(): PlatformId {
    return this.p
  }
  async startOAuth(_mode: OAuthMode): Promise<OAuthPending> {
    return {
      pendingId: 'fixed-id',
      authorizeUrl: `https://auth/${this.p}`,
      redirectPath: '/oauth/callback',
      boundPort: 3128,
      state: 'st',
      codeVerifier: 'cv',
    }
  }
  async completeOAuth(_id: string, _code: string): Promise<ImportedCredentialMaterial> {
    return { provider: this.p, email: 'u@e.com', accessToken: 'tok', source: 'oauth' }
  }
}

class FakeLocal implements LocalImportCapability {
  constructor(private readonly p: PlatformId) {}
  provider(): PlatformId {
    return this.p
  }
  async scanLocal(): Promise<ImportedCredentialMaterial[]> {
    return [{ provider: this.p, email: 'local@e.com', accessToken: 'lt', source: 'local_scan' }]
  }
}

class FakeFile implements FileImportCapability {
  constructor(private readonly p: PlatformId) {}
  provider(): PlatformId {
    return this.p
  }
  async importFromJson(_payload: string): Promise<ImportedCredentialMaterial> {
    return { provider: this.p, email: 'json@e.com', accessToken: 'jt', source: 'token_json_file' }
  }
}

class FakeDeepLink implements DeepLinkImportCapability {
  constructor(private readonly p: PlatformId) {}
  provider(): PlatformId {
    return this.p
  }
  async importFromDeeplink(_url: string): Promise<ImportedCredentialMaterial> {
    return { provider: this.p, email: 'dl@e.com', accessToken: 'dt', source: 'deep_link' }
  }
}

class FakeValidation implements CredentialValidationCapability {
  constructor(
    private readonly p: PlatformId,
    private readonly result: CredentialValidationResult,
  ) {}
  provider(): PlatformId {
    return this.p
  }
  async validate(_env: StoredEnvelope): Promise<CredentialValidationResult> {
    return this.result
  }
}

class InMemoryCredentialRepo implements CredentialRepository {
  readonly envelopes = new Map<string, StoredEnvelope>()
  async store(_a: string, _p: PlatformId, _c: Credential): Promise<void> {}
  async retrieve(): Promise<Credential | null> {
    return null
  }
  async delete(): Promise<void> {}
  async loadEnvelope(accountId: string): Promise<StoredEnvelope | null> {
    return this.envelopes.get(accountId) ?? null
  }
}

function envelopeFor(provider: PlatformId): StoredEnvelope {
  return {
    aad: { provider, accountId: 'acc', createdAt: new Date().toISOString() },
    envelope: { v: 1, iv: '', ciphertext: '', tag: '' },
  }
}

describe('OAuthService', () => {
  let pending: InMemoryPendingOAuth
  let registry: ProviderRegistry

  beforeEach(() => {
    pending = new InMemoryPendingOAuth()
    registry = new ProviderRegistry()
  })

  it('start persists the pending record with state + code_verifier', async () => {
    registry.registerOAuth(new FakeOAuth('kiro'))
    const svc = new OAuthService(registry, pending)
    const handle = await svc.start('kiro', 'loopback_pkce')
    expect(handle.pendingId).toBe('fixed-id')
    const record = await pending.findById('fixed-id')
    expect(record?.provider).toBe('kiro')
    expect(record?.state).toBe('st')
    expect(record?.codeVerifier).toBe('cv')
    expect(record?.boundPort).toBe(3128)
  })

  it('start throws UnsupportedSource when no OAuth capability is registered', async () => {
    const svc = new OAuthService(registry, pending)
    await expect(svc.start('zed', 'loopback_pkce')).rejects.toBeInstanceOf(CredentialError)
  })

  it('complete deletes the pending record on success', async () => {
    registry.registerOAuth(new FakeOAuth('kiro'))
    const svc = new OAuthService(registry, pending)
    await svc.start('kiro', 'loopback_pkce')
    const material = await svc.complete('fixed-id', '')
    expect(material.accessToken).toBe('tok')
    expect(await pending.findById('fixed-id')).toBeNull()
  })

  it('complete throws internal error for an unknown pending id', async () => {
    const svc = new OAuthService(registry, pending)
    await expect(svc.complete('nope', '')).rejects.toThrow(/pending oauth nope not found/)
  })

  it('purgeExpired removes only expired rows', async () => {
    const now = Date.now()
    await pending.save({
      id: 'old',
      provider: 'kiro',
      state: 's',
      codeVerifier: 'v',
      redirectPath: '/x',
      createdAt: new Date(now - 20 * 60_000),
      expiresAt: new Date(now - 10 * 60_000),
    })
    await pending.save({
      id: 'fresh',
      provider: 'kiro',
      state: 's',
      codeVerifier: 'v',
      redirectPath: '/x',
      createdAt: new Date(now),
      expiresAt: new Date(now + 10 * 60_000),
    })
    const svc = new OAuthService(registry, pending)
    expect(await svc.purgeExpired()).toBe(1)
    expect(await pending.findById('old')).toBeNull()
    expect(await pending.findById('fresh')).not.toBeNull()
  })
})

describe('ImportService', () => {
  let registry: ProviderRegistry
  beforeEach(() => {
    registry = new ProviderRegistry()
  })

  it('importFromJson dispatches to the file capability', async () => {
    registry.registerFileImport(new FakeFile('cursor'))
    const svc = new ImportService(registry)
    const m = await svc.importFromJson('cursor', '{}')
    expect(m.source).toBe('token_json_file')
  })

  it('importFromJson throws UnsupportedSource when missing', async () => {
    const svc = new ImportService(registry)
    await expect(svc.importFromJson('cursor', '{}')).rejects.toBeInstanceOf(CredentialError)
  })

  it('scanLocal returns materials from the local capability', async () => {
    registry.registerLocalImport(new FakeLocal('cursor'))
    const svc = new ImportService(registry)
    const m = await svc.scanLocal('cursor')
    expect(m).toHaveLength(1)
    expect(m[0].source).toBe('local_scan')
  })

  it('importFromDeeplink dispatches to the deep-link capability', async () => {
    registry.registerDeepLink(new FakeDeepLink('kiro'))
    const svc = new ImportService(registry)
    const m = await svc.importFromDeeplink('kiro', 'haoxiaoguan://import/kiro?token=x')
    expect(m.source).toBe('deep_link')
  })

  it('scanLocal throws UnsupportedSource for a provider with no local capability', async () => {
    const svc = new ImportService(registry)
    await expect(svc.scanLocal('zed')).rejects.toMatchObject({ kind: 'unsupported_source' })
  })
})

describe('ValidationService', () => {
  let repo: InMemoryCredentialRepo
  let registry: ProviderRegistry
  beforeEach(() => {
    repo = new InMemoryCredentialRepo()
    registry = new ProviderRegistry()
  })

  it('validate returns unsupported when no validation capability is registered', async () => {
    repo.envelopes.set('acc', envelopeFor('cursor'))
    const svc = new ValidationService(repo, registry)
    const r = await svc.validate('acc')
    expect(r.state).toBe('unsupported')
  })

  it('validate dispatches to the provider capability resolved from the envelope', async () => {
    repo.envelopes.set('acc', envelopeFor('kiro'))
    registry.registerValidation(
      new FakeValidation('kiro', { state: 'valid', checkedAt: new Date() }),
    )
    const svc = new ValidationService(repo, registry)
    const r = await svc.validate('acc')
    expect(r.state).toBe('valid')
  })

  it('validate throws when the account has no envelope', async () => {
    const svc = new ValidationService(repo, registry)
    await expect(svc.validate('missing')).rejects.toBeInstanceOf(CredentialError)
  })

  it('validateBatch isolates per-account errors into the result array', async () => {
    repo.envelopes.set('ok', envelopeFor('kiro'))
    registry.registerValidation(
      new FakeValidation('kiro', { state: 'valid', checkedAt: new Date() }),
    )
    const svc = new ValidationService(repo, registry)
    const items = await svc.validateBatch(['ok', 'missing'], 2)
    const okItem = items.find((i) => i.accountId === 'ok')
    const missingItem = items.find((i) => i.accountId === 'missing')
    expect(okItem?.result?.state).toBe('valid')
    expect(missingItem?.error).toBeTruthy()
  })
})
