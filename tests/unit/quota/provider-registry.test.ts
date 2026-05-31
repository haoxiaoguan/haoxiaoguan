import { describe, it, expect } from 'vitest'
import { ProviderRegistry } from '../../../src/main/contexts/quota/domain/provider-registry'
import type {
  CredentialValidationCapability,
  CredentialValidationResult,
  QuotaCapability,
  QuotaFetchResult,
} from '../../../src/main/contexts/quota/domain/capabilities'
import type { Credential } from '../../../src/main/contexts/account/domain/credential'
import type { JsonValue } from '../../../src/main/contexts/account/domain/platform-account-profile'
import type { PlatformId } from '../../../src/main/contexts/quota/domain/platform-id'

class StubValidator implements CredentialValidationCapability {
  constructor(private p: PlatformId) {}
  provider(): PlatformId {
    return this.p
  }
  async validate(_credential: Credential): Promise<CredentialValidationResult> {
    return { state: 'unsupported', checkedAt: new Date() }
  }
}

class StubQuota implements QuotaCapability {
  constructor(private p: PlatformId) {}
  provider(): PlatformId {
    return this.p
  }
  async fetchQuota(_credential: Credential, _payload: JsonValue): Promise<QuotaFetchResult> {
    return {
      outcome: 'unsupported',
      source: 'none',
      freshness: 'unknown',
      fetchedAt: new Date(),
      models: [],
      providerPayload: null,
      updatedCredential: undefined,
      error: undefined,
    }
  }
}

describe('ProviderRegistry', () => {
  it('empty registry returns undefined for every capability', () => {
    const r = new ProviderRegistry()
    expect(r.validation('cursor')).toBeUndefined()
    expect(r.quota('kiro')).toBeUndefined()
    expect(r.injector('codex')).toBeUndefined()
    expect(r.registeredProviders()).toEqual([])
  })

  it('registers and looks up a capability by provider', () => {
    const r = new ProviderRegistry()
    r.registerValidation(new StubValidator('kiro'))
    const cap = r.validation('kiro')
    expect(cap?.provider()).toBe('kiro')
    expect(r.validation('cursor')).toBeUndefined()
  })

  it('registeredProviders aggregates unique providers, sorted', () => {
    const r = new ProviderRegistry()
    r.registerValidation(new StubValidator('kiro'))
    r.registerQuota(new StubQuota('kiro'))
    r.registerQuota(new StubQuota('cursor'))
    expect(r.registeredProviders()).toEqual(['cursor', 'kiro'])
  })
})
