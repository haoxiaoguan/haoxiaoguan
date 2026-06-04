import { describe, it, expect } from 'vitest'
import { Account } from '../../../src/main/contexts/account/domain/account'
import { PlatformAccountProfile } from '../../../src/main/contexts/account/domain/platform-account-profile'
import { AccountError } from '../../../src/main/contexts/account/domain/account-error'

describe('Account aggregate', () => {
  it('creates with all fields, starts inactive', () => {
    const account = Account.create('cursor', 'user@example.com', 'My Account', ['dev', 'main'], 'Primary')
    expect(account.agentId).toBe('cursor')
    expect(account.email).toBe('user@example.com')
    expect(account.name?.asStr()).toBe('My Account')
    expect(account.tags.length).toBe(2)
    expect(account.notes?.asStr()).toBe('Primary')
    expect(account.isActive).toBe(false)
    expect(account.lastUsedAt).toBeUndefined()
  })

  it('activate sets active + last_used_at and emits event', () => {
    const account = Account.create('kiro', 'user@example.com', undefined, [], undefined)
    expect(account.isActive).toBe(false)
    const event = account.activate()
    expect(account.isActive).toBe(true)
    expect(account.lastUsedAt).toBeInstanceOf(Date)
    expect(event.agentId).toBe('kiro')
    expect(event.accountId).toBe(account.id)
  })

  it('deactivate clears active', () => {
    const account = Account.create('cursor', 'u@e.com', undefined, [], undefined)
    account.activate()
    account.deactivate()
    expect(account.isActive).toBe(false)
  })

  it('propagates validation errors from value objects', () => {
    try {
      Account.create('cursor', 'u@e.com', 'a'.repeat(65), [], undefined)
      throw new Error('expected throw')
    } catch (e) {
      expect((e as AccountError).kind).toBe('NameTooLong')
    }
  })

  it('createWithProfile preserves identity + plan fields', () => {
    const profile = new PlatformAccountProfile({
      identityKey: 'kiro-user-123',
      displayIdentifier: 'kiro-user-123',
      loginProvider: 'Github',
      planName: 'Kiro Pro',
      planTier: 'pro',
      status: 'normal',
      profilePayload: { userId: 'kiro-user-123', creditsTotal: 100, creditsUsed: 25 },
    })
    const account = Account.createWithProfile('kiro', 'kiro-user-123', 'Kiro Github', ['AWS SSO'], undefined, profile)
    expect(account.identityKey).toBe('kiro-user-123')
    expect(account.displayIdentifier).toBe('kiro-user-123')
    expect(account.loginProvider).toBe('Github')
    expect(account.planName).toBe('Kiro Pro')
    expect(account.planTier).toBe('pro')
    expect(account.status).toBe('normal')
    expect((account.profilePayload as Record<string, unknown>).creditsTotal).toBe(100)
  })

  it('healDisplayIdentity promotes a live email onto the display fields, leaving identityKey frozen', () => {
    // 导入时 email 缺失 → displayIdentifier/email 落到不透明 userId 占位。
    const profile = new PlatformAccountProfile({
      identityKey: 'd-9067-abc',
      displayIdentifier: 'd-9067-abc',
      loginProvider: 'Builder ID',
      planName: 'KIRO FREE',
      planTier: 'free',
      status: 'normal',
      profilePayload: { userId: 'd-9067-abc' },
    })
    const account = Account.createWithProfile('kiro', 'd-9067-abc', undefined, [], undefined, profile)
    const keyBefore = account.identityKey
    expect(account.displayIdentifier).toBe('d-9067-abc')

    // 在线刷新取回 email → 自愈显示，identityKey 冻结（唯一性/额度关联安全）。
    expect(account.healDisplayIdentity('galardo@example.com')).toBe(true)
    expect(account.displayIdentifier).toBe('galardo@example.com')
    expect(account.email).toBe('galardo@example.com')
    expect(account.identityKey).toBe(keyBefore)

    // 幂等 + 不拿新 email 覆盖已是 email 的显示 + 非法输入一律 no-op。
    expect(account.healDisplayIdentity('other@example.com')).toBe(false)
    expect(account.displayIdentifier).toBe('galardo@example.com')
    expect(account.healDisplayIdentity('not-an-email')).toBe(false)
  })

  it('updateProfilePayload merges and re-derives platform fields', () => {
    const profile = new PlatformAccountProfile({
      identityKey: 'user@example.com',
      displayIdentifier: 'user@example.com',
      planName: 'Free',
      profilePayload: { email: 'user@example.com', old: true },
    })
    const account = Account.createWithProfile('cursor', 'user@example.com', undefined, [], undefined, profile)
    account.updateProfilePayload({ planName: 'Pro', status: 'normal', cursor_usage_raw: { usage: 1 } })
    expect(account.planName).toBe('Pro')
    expect(account.status).toBe('normal')
    const payload = account.profilePayload as Record<string, unknown>
    expect(payload.old).toBe(true)
    expect((payload.cursor_usage_raw as Record<string, unknown>).usage).toBe(1)
  })

  it('generates unique ids', () => {
    const a1 = Account.create('cursor', 'u1@e.com', undefined, [], undefined)
    const a2 = Account.create('cursor', 'u2@e.com', undefined, [], undefined)
    expect(a1.id).not.toBe(a2.id)
  })
})
