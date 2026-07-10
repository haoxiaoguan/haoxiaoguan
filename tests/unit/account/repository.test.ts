import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { randomBytes } from 'node:crypto'
import type { EntityManager } from '@mikro-orm/better-sqlite'
import { createTestOrm, type TestOrm } from './test-orm'
import { CryptoService } from '../../../src/main/platform/crypto/crypto-service'
import { Account } from '../../../src/main/contexts/account/domain/account'
import { MikroOrmAccountRepository } from '../../../src/main/contexts/account/infrastructure/mikro-orm-account-repository'
import { MikroOrmSwitchHistoryRepository } from '../../../src/main/contexts/account/infrastructure/mikro-orm-switch-history-repository'
import { MikroOrmCredentialRepository } from '../../../src/main/contexts/credential/infrastructure/mikro-orm-credential-repository'
import { AccountApplicationService } from '../../../src/main/contexts/account/application/account-service'
import { SwitchService } from '../../../src/main/contexts/account/application/switch-service'
import type {
  CredentialInjectionPort,
  CredentialInjectorRegistry,
} from '../../../src/main/contexts/account/domain/ports'
import type { PlatformId } from '../../../src/main/contexts/account/domain/platform-id'

// In-memory sqlite repository round-trip tests. Entities are registered
// explicitly via createTestOrm (MikroORM glob discovery can't load .ts under
// vitest); the production runtime uses the compiled .js glob.

// A no-op injector registry: every platform injects successfully (the on-disk
// IDE write is exercised separately in the agents injection tests).
class NoopInjector implements CredentialInjectionPort {
  async inject(): Promise<void> {
    /* no-op */
  }
}
class NoopInjectorRegistry implements CredentialInjectorRegistry {
  private readonly inj = new NoopInjector()
  injector(_platform: PlatformId): CredentialInjectionPort | undefined {
    return this.inj
  }
}

function makeCrypto(): CryptoService {
  return new CryptoService(randomBytes(32))
}

let testOrm: TestOrm
let em: () => EntityManager

beforeEach(async () => {
  testOrm = await createTestOrm()
  em = testOrm.em
})

afterEach(async () => {
  await testOrm.close()
})

describe('MikroOrmAccountRepository', () => {
  it('saves and finds by id with tags', async () => {
    const repo = new MikroOrmAccountRepository(em)
    const account = Account.create('cursor', 'user@example.com', 'Test Account', ['dev', 'main'], 'notes')
    await repo.save(account)
    const got = await repo.findById(account.id)
    expect(got).not.toBeNull()
    expect(got!.agentId).toBe('cursor')
    expect(got!.email).toBe('user@example.com')
    expect(got!.name?.asStr()).toBe('Test Account')
    expect(got!.tags.length).toBe(2)
  })

  it('preserves platform profile fields on round-trip', async () => {
    const repo = new MikroOrmAccountRepository(em)
    const { PlatformAccountProfile } = await import(
      '../../../src/main/contexts/account/domain/platform-account-profile'
    )
    const profile = new PlatformAccountProfile({
      identityKey: 'kiro-user-123',
      displayIdentifier: 'kiro-user-123',
      loginProvider: 'Github',
      planName: 'Kiro Pro',
      planTier: 'pro',
      status: 'normal',
      profilePayload: { userId: 'kiro-user-123', creditsTotal: 100, creditsUsed: 25 },
    })
    const account = Account.createWithProfile('kiro', 'kiro-user-123', 'Kiro', ['AWS SSO'], undefined, profile)
    await repo.save(account)
    const got = await repo.findById(account.id)
    expect(got!.identityKey).toBe('kiro-user-123')
    expect(got!.loginProvider).toBe('Github')
    expect(got!.planTier).toBe('pro')
    expect((got!.profilePayload as Record<string, unknown>).creditsTotal).toBe(100)
    expect(await repo.existsByIdentifier('kiro', 'kiro-user-123')).toBe(true)
  })

  it('finds by platform and active by platform', async () => {
    const repo = new MikroOrmAccountRepository(em)
    const active = Account.create('cursor', 'active@e.com', undefined, [], undefined)
    active.activate()
    await repo.save(active)
    await repo.save(Account.create('cursor', 'inactive@e.com', undefined, [], undefined))
    await repo.save(Account.create('windsurf', 'w@e.com', undefined, [], undefined))

    expect((await repo.findByPlatform('cursor')).length).toBe(2)
    expect((await repo.findByPlatform('windsurf')).length).toBe(1)
    const found = await repo.findActiveByPlatform('cursor')
    expect(found?.email).toBe('active@e.com')
    expect(await repo.findActiveByPlatform('windsurf')).toBeNull()
  })

  it('finds by tags (any match, deduped)', async () => {
    const repo = new MikroOrmAccountRepository(em)
    await repo.save(Account.create('cursor', 'u1@e.com', undefined, ['dev', 'main'], undefined))
    await repo.save(Account.create('windsurf', 'u2@e.com', undefined, ['dev', 'test'], undefined))
    await repo.save(Account.create('kiro', 'u3@e.com', undefined, ['prod'], undefined))
    expect((await repo.findByTags(['dev'])).length).toBe(2)
    expect((await repo.findByTags(['prod'])).length).toBe(1)
    expect((await repo.findByTags([])).length).toBe(0)
  })

  it('replaces tags wholesale on update', async () => {
    const repo = new MikroOrmAccountRepository(em)
    const a = Account.create('cursor', 'u@e.com', undefined, ['old_tag'], undefined)
    await repo.save(a)
    a.addTag('new_tag')
    await repo.save(a)
    const got = await repo.findById(a.id)
    expect(got!.tags.length).toBe(2)
    expect([...got!.tags.asSlice()].sort()).toEqual(['new_tag', 'old_tag'])
  })

  it('deletes account and cascades tags', async () => {
    const repo = new MikroOrmAccountRepository(em)
    const a = Account.create('cursor', 'u@e.com', undefined, ['t1'], undefined)
    await repo.save(a)
    await repo.delete(a.id)
    expect(await repo.findById(a.id)).toBeNull()
  })

  it('existsByIdentifier normalizes case', async () => {
    const repo = new MikroOrmAccountRepository(em)
    await repo.save(Account.create('cursor', 'User@Example.com', undefined, [], undefined))
    // identity_key is lowercased+trimmed at creation; lookup normalizes input.
    expect(await repo.existsByIdentifier('cursor', 'user@example.com')).toBe(true)
    expect(await repo.existsByIdentifier('cursor', '  USER@EXAMPLE.COM ')).toBe(true)
    expect(await repo.existsByIdentifier('windsurf', 'user@example.com')).toBe(false)
  })
})

describe('MikroOrmSwitchHistoryRepository', () => {
  it('records and finds recent ordered by switched_at desc', async () => {
    const repo = new MikroOrmSwitchHistoryRepository(em)
    await repo.record({
      accountId: 'a1',
      agentId: 'cursor',
      triggerType: 'manual',
      success: true,
      switchedAt: new Date('2024-01-01T00:00:00Z'),
    })
    await repo.record({
      accountId: 'a2',
      agentId: 'windsurf',
      triggerType: 'auto',
      success: false,
      errorMessage: 'boom',
      switchedAt: new Date('2024-06-01T00:00:00Z'),
    })
    const recent = await repo.findRecent(10)
    expect(recent.length).toBe(2)
    expect(recent[0].agentId).toBe('windsurf')
    expect(recent[0].success).toBe(false)
    expect(recent[0].errorMessage).toBe('boom')
    expect(recent[1].agentId).toBe('cursor')
  })

  it('respects the limit', async () => {
    const repo = new MikroOrmSwitchHistoryRepository(em)
    for (let i = 0; i < 5; i += 1) {
      await repo.record({
        accountId: `a${i}`,
        agentId: 'cursor',
        triggerType: 'manual',
        success: true,
        switchedAt: new Date(),
      })
    }
    expect((await repo.findRecent(3)).length).toBe(3)
  })
})

describe('AccountApplicationService (sqlite end-to-end)', () => {
  function buildService(): AccountApplicationService {
    const accountRepo = new MikroOrmAccountRepository(em)
    const credentialStore = new MikroOrmCredentialRepository(makeCrypto(), em)
    const switchService = new SwitchService(credentialStore, new NoopInjectorRegistry())
    return new AccountApplicationService(accountRepo, credentialStore, switchService)
  }

  it('imports an account and stores its credential', async () => {
    const svc = buildService()
    const account = await svc.importAccount({
      platform: 'cursor',
      email: 'user@example.com',
      token: 'tok',
      refreshToken: 'refresh',
      name: 'My Account',
      tags: ['dev'],
      notes: 'notes',
    })
    expect(account.email).toBe('user@example.com')
    expect(account.isActive).toBe(false)
    const repo = new MikroOrmAccountRepository(em)
    expect(await repo.findById(account.id)).not.toBeNull()
  })

  it('rejects duplicate identifier', async () => {
    const svc = buildService()
    await svc.importAccount({ platform: 'cursor', email: 'dup@e.com', token: 't1', tags: [] })
    await expect(
      svc.importAccount({ platform: 'cursor', email: 'dup@e.com', token: 't2', tags: [] }),
    ).rejects.toThrow(/Duplicate identifier/)
  })

  it('switches: activates target and decrypts+injects credential', async () => {
    const svc = buildService()
    const account = await svc.importAccount({ platform: 'cursor', email: 'u@e.com', token: 'tok', tags: [] })
    await svc.switchAccount(account.id)
    const repo = new MikroOrmAccountRepository(em)
    const got = await repo.findById(account.id)
    expect(got!.isActive).toBe(true)
    expect(got!.lastUsedAt).toBeInstanceOf(Date)
  })

  it('deletes account and its credential', async () => {
    const svc = buildService()
    const account = await svc.importAccount({ platform: 'cursor', email: 'u@e.com', token: 'tok', tags: [] })
    const store = new MikroOrmCredentialRepository(makeCrypto(), em)
    await svc.deleteAccount(account.id)
    const repo = new MikroOrmAccountRepository(em)
    expect(await repo.findById(account.id)).toBeNull()
    expect(await store.retrieve(account.id)).toBeNull()
  })

  it('batch delete counts successes and skips not-found', async () => {
    const svc = buildService()
    const a1 = await svc.importAccount({ platform: 'cursor', email: 'u1@e.com', token: 't1', tags: [] })
    const a2 = await svc.importAccount({ platform: 'windsurf', email: 'u2@e.com', token: 't2', tags: [] })
    const deleted = await svc.batchDelete([a1.id, a2.id, '00000000-0000-0000-0000-000000000000'])
    expect(deleted).toBe(2)
  })

  it('filters by platform and tags', async () => {
    const svc = buildService()
    await svc.importAccount({ platform: 'cursor', email: 'u1@e.com', token: 't1', tags: ['dev', 'main'] })
    await svc.importAccount({ platform: 'windsurf', email: 'u2@e.com', token: 't2', tags: ['test'] })
    expect((await svc.filterAccounts('cursor', undefined)).length).toBe(1)
    expect((await svc.filterAccounts(undefined, ['dev'])).length).toBe(1)
    expect((await svc.filterAccounts(undefined, undefined)).length).toBe(0)
    expect((await svc.filterAccounts('cursor', ['dev'])).length).toBe(1)
    expect((await svc.filterAccounts('windsurf', ['dev'])).length).toBe(0)
  })

  it('exports then imports round-trip with credentials', async () => {
    const svc = buildService()
    const a = await svc.importAccount({
      platform: 'cursor',
      email: 'export@e.com',
      token: 'tok',
      refreshToken: 'refresh',
      tags: ['x'],
    })
    // 开启 Cursor 自动退款开关，验证它随导出走（存 profilePayload，不随 rawMetadata 现推）。
    await svc.setAccountAutoRefund(a.id, true)
    const exportData = await svc.exportAccounts([a.id], true)
    expect(exportData.accounts[0].platform).toBe('cursor')
    expect(exportData.accounts[0].credential?.token).toBe('tok')
    expect(exportData.accounts[0].auto_refund_enabled).toBe(true)

    // Re-import the same data. Faithful to the source: the conflict pre-check
    // queries existsByIdentifier(platform, email), but the stored identity_key
    // was sanitized from the email ('export@e.com' -> 'export-e.com'), so the
    // pre-check misses; the re-import's own duplicate guard then rejects it,
    // landing in `errors`. Either way nothing new is imported.
    const reimport = await svc.importFromJson(JSON.stringify(exportData), 'skip')
    expect(reimport.imported).toBe(0)
    expect(reimport.skipped + reimport.errors.length).toBe(1)

    // The account set is unchanged (still exactly one cursor account).
    const repo = new MikroOrmAccountRepository(em)
    expect((await repo.findByPlatform('cursor')).length).toBe(1)
  })

  it('imports a fresh account from export JSON (no conflict)', async () => {
    const svc = buildService()
    // Build an export payload whose identity_key round-trips cleanly so the
    // conflict pre-check is exercised on a NON-conflicting id (fresh DB).
    const exportData = {
      version: '1.0',
      exported_at: new Date().toISOString(),
      accounts: [
        {
          id: 'seed-1',
          platform: 'cursor',
          email: 'fresh@e.com',
          name: 'Fresh',
          tags: ['t'],
          notes: null,
          is_active: false,
          created_at: new Date().toISOString(),
          last_used_at: null,
          auto_refund_enabled: true,
          credential: { token: 'tok', refresh_token: null },
        },
      ],
    }
    const result = await svc.importFromJson(JSON.stringify(exportData), 'skip')
    expect(result.imported).toBe(1)
    expect(result.skipped).toBe(0)
    expect(result.errors).toEqual([])

    // 导出里的 auto_refund_enabled 应被还原到导入账号的 profilePayload。
    const repo = new MikroOrmAccountRepository(em)
    const imported = (await repo.findByPlatform('cursor')).find((x) => x.email === 'fresh@e.com')
    expect(imported?.autoRefundEnabled).toBe(true)
  })
})
