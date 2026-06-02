import { describe, it, expect } from 'vitest'
import { AccountApplicationService } from '../../../src/main/contexts/account/application/account-service'
import { Account } from '../../../src/main/contexts/account/domain/account'
import { PlatformAccountProfile } from '../../../src/main/contexts/account/domain/platform-account-profile'
import type { PlatformId } from '../../../src/main/contexts/account/domain/platform-id'
import { platformToAgentId } from '../../../src/main/contexts/account/domain/platform-id'

// Build a real Account aggregate for a platform with a given identity.
function makeAccount(platform: PlatformId, identity: string, isActive: boolean): Account {
  const profile = PlatformAccountProfile.fromIdentifier(identity)
  const a = Account.createWithProfile(platformToAgentId(platform), identity, undefined, [], undefined, profile)
  if (isActive) a.activate()
  return a
}

// In-memory account repo over a fixed list.
function fakeRepo(accounts: Account[]) {
  const saved: string[] = []
  return {
    saved,
    repo: {
      findById: async (id: string) => accounts.find((a) => a.id === id) ?? null,
      findActiveByPlatform: async (p: PlatformId) => {
        const agentId = platformToAgentId(p)
        return accounts.find((a) => a.agentId === agentId && a.isActive) ?? null
      },
      save: async (a: Account) => {
        saved.push(a.id)
      },
      findByPlatform: async () => [] as never,
      findByTags: async () => [] as never,
      delete: async () => {},
      existsByIdentifier: async () => false,
    },
  }
}

// SwitchService stand-in recording which account had its credential injected.
function fakeSwitchService() {
  const injected: string[] = []
  return {
    injected,
    svc: {
      switchAccount: async (account: Account) => {
        injected.push(account.id)
        return { success: true, platformLaunched: false }
      },
    },
  }
}

const noopCredentialStore = {} as never

describe('AccountApplicationService.switchAccount', () => {
  it('deactivates the current active, injects, then activates the target (one active per platform)', async () => {
    const current = makeAccount('cursor', 'alice', true)
    const target = makeAccount('cursor', 'bob', false)
    const { repo, saved } = fakeRepo([current, target])
    const { svc: switchSvc, injected } = fakeSwitchService()
    const service = new AccountApplicationService(repo as never, noopCredentialStore, switchSvc as never)

    await service.switchAccount(target.id)

    expect(current.isActive).toBe(false)
    expect(target.isActive).toBe(true)
    expect(injected).toEqual([target.id]) // credential injected for the target
    // both persisted (deactivate current + activate target)
    expect(saved).toContain(current.id)
    expect(saved).toContain(target.id)
  })

  it('is idempotent-ish: switching to the already-active account keeps it active + reinjects', async () => {
    const current = makeAccount('cursor', 'alice', true)
    const { repo } = fakeRepo([current])
    const { svc: switchSvc, injected } = fakeSwitchService()
    const service = new AccountApplicationService(repo as never, noopCredentialStore, switchSvc as never)

    await service.switchAccount(current.id)

    expect(current.isActive).toBe(true)
    expect(injected).toEqual([current.id])
  })

  it('isolates platforms: switching cursor does not touch the active kiro account', async () => {
    const cursorOld = makeAccount('cursor', 'alice', true)
    const cursorNew = makeAccount('cursor', 'bob', false)
    const kiroActive = makeAccount('kiro', 'd-123', true)
    const { repo } = fakeRepo([cursorOld, cursorNew, kiroActive])
    const { svc: switchSvc } = fakeSwitchService()
    const service = new AccountApplicationService(repo as never, noopCredentialStore, switchSvc as never)

    await service.switchAccount(cursorNew.id)

    expect(cursorOld.isActive).toBe(false)
    expect(cursorNew.isActive).toBe(true)
    expect(kiroActive.isActive).toBe(true) // untouched — different platform
  })
})
