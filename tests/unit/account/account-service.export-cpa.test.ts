import { describe, it, expect } from 'vitest'
import { AccountApplicationService } from '../../../src/main/contexts/account/application/account-service'
import { Account } from '../../../src/main/contexts/account/domain/account'
import { Credential } from '../../../src/main/contexts/account/domain/credential'
import { PlatformAccountProfile } from '../../../src/main/contexts/account/domain/platform-account-profile'
import type { JsonValue } from '../../../src/main/contexts/account/domain/platform-account-profile'
import type { PlatformId } from '../../../src/main/contexts/account/domain/platform-id'
import { platformToAgentId } from '../../../src/main/contexts/account/domain/platform-id'

function makeAccount(platform: PlatformId, identity: string): Account {
  const profile = PlatformAccountProfile.fromIdentifier(identity)
  return Account.createWithProfile(platformToAgentId(platform), identity, undefined, [], undefined, profile)
}

function fakeRepo(accounts: Account[]) {
  return {
    findById: async (id: string) => accounts.find((a) => a.id === id) ?? null,
    findActiveByPlatform: async () => null,
    save: async () => {},
    findByPlatform: async () => [] as never,
    findByTags: async () => [] as never,
    delete: async () => {},
    existsByIdentifier: async () => false,
  }
}

function fakeCredStore(map: Map<string, Credential>) {
  return {
    store: async () => {},
    retrieve: async (accountId: string) => map.get(accountId) ?? null,
    delete: async () => {},
  }
}

const noopSwitch = { switchAccount: async () => ({ success: true, platformLaunched: false }) }

function makeService(accounts: Account[], creds: Map<string, Credential>) {
  return new AccountApplicationService(
    fakeRepo(accounts) as never,
    fakeCredStore(creds) as never,
    noopSwitch as never,
  )
}

describe('AccountApplicationService.exportAccountsCpa', () => {
  it('builds the flat cpa object for a codex account (live tokens win, raw fields carried over)', async () => {
    const account = makeAccount('codex', 'a@x.com')
    const raw: JsonValue = {
      id_token: 'IDT',
      access_token: 'stale-AT',
      refresh_token: 'stale-RT',
      account_id: 'ACC-1',
      last_refresh: '2026-01-01T00:00:00Z',
      expired: '2026-06-01T00:00:00Z',
    }
    const creds = new Map([[account.id, new Credential('live-AT', 'live-RT', undefined, raw)]])
    const service = makeService([account], creds)

    const [cpa] = (await service.exportAccountsCpa([account.id])) as Array<Record<string, unknown>>
    expect(cpa).toEqual({
      id_token: 'IDT',
      access_token: 'live-AT',
      refresh_token: 'live-RT',
      account_id: 'ACC-1',
      last_refresh: '2026-01-01T00:00:00Z',
      email: 'a@x.com',
      type: 'codex',
      expired: '2026-06-01T00:00:00Z',
    })
  })

  it('reads id_token/account_id from the nested `tokens` object (codex auth.json shape)', async () => {
    const account = makeAccount('codex', 'b@x.com')
    const raw: JsonValue = {
      tokens: { id_token: 'IDT-n', access_token: 'AT-n', refresh_token: 'RT-n', account_id: 'ACC-n' },
      last_refresh: '2026-02-02T00:00:00Z',
    }
    const creds = new Map([[account.id, new Credential('AT-live', 'RT-live', undefined, raw)]])
    const service = makeService([account], creds)

    const [cpa] = (await service.exportAccountsCpa([account.id])) as Array<Record<string, unknown>>
    expect(cpa.id_token).toBe('IDT-n')
    expect(cpa.account_id).toBe('ACC-n')
    expect(cpa.access_token).toBe('AT-live')
    expect(cpa.refresh_token).toBe('RT-live')
    expect(cpa.tokens).toBeUndefined() // nested object never leaks through
  })

  it('passes platform-specific scalar extras through (kiro clientId/provider)', async () => {
    const account = makeAccount('kiro', 'k@x.com')
    const raw: JsonValue = {
      refreshToken: 'RT-k',
      clientId: 'CID',
      clientSecret: 'CSEC',
      provider: 'BuilderId',
    }
    const creds = new Map([[account.id, new Credential('AT-k', 'RT-k', undefined, raw)]])
    const service = makeService([account], creds)

    const [cpa] = (await service.exportAccountsCpa([account.id])) as Array<Record<string, unknown>>
    expect(cpa.clientId).toBe('CID')
    expect(cpa.clientSecret).toBe('CSEC')
    expect(cpa.provider).toBe('BuilderId')
    expect(cpa.refresh_token).toBe('RT-k')
    expect(cpa.refreshToken).toBeUndefined() // duplicate spelling collapsed
    expect(cpa.type).toBe('kiro')
  })

  it('falls back to credential expiry and minimal fields when raw_metadata is absent', async () => {
    const account = makeAccount('codex', 'c@x.com')
    const expires = new Date('2026-07-01T00:00:00Z')
    const creds = new Map([[account.id, new Credential('AT', 'RT', expires)]])
    const service = makeService([account], creds)

    const [cpa] = (await service.exportAccountsCpa([account.id])) as Array<Record<string, unknown>>
    expect(cpa).toEqual({
      access_token: 'AT',
      refresh_token: 'RT',
      email: 'c@x.com',
      type: 'codex',
      expired: expires.toISOString(),
    })
  })

  it('throws for an unknown account id', async () => {
    const service = makeService([], new Map())
    await expect(service.exportAccountsCpa(['nope'])).rejects.toThrow()
  })
})
