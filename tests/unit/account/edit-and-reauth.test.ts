import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { AccountApplicationService } from '../../../src/main/contexts/account/application/account-service'
import { Account } from '../../../src/main/contexts/account/domain/account'
import { AccountError } from '../../../src/main/contexts/account/domain/account-error'
import { Tags } from '../../../src/main/contexts/account/domain/tags'
import { Notes } from '../../../src/main/contexts/account/domain/notes'
import { AccountName } from '../../../src/main/contexts/account/domain/account-name'

// Tests for the new editable-metadata + re-authenticate paths.
//
// We stub out the repository + credential store so the tests stay focused on
// the application-service contract: identity guard on re-auth, name/tags/notes
// invariants on edit.

function makeKiroAccount(): Account {
  // The kiro profile normalizer converts `alice@example.com` into the identity
  // key `alice-example.com` (path-safe). Use that pre-normalized form so the
  // re-auth identity guard treats a fresh kiro login as the SAME principal.
  return Account.reconstruct({
    id: 'acc-1',
    agentId: 'kiro',
    email: 'alice@example.com',
    identityKey: 'alice-example.com',
    displayIdentifier: 'alice@example.com',
    name: AccountName.create('Alice'),
    profilePayload: { email: 'alice@example.com' },
    tags: Tags.create(['old']),
    notes: Notes.create('initial'),
    isActive: false,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  })
}

describe('AccountApplicationService.updateAccountMetadata', () => {
  let account: Account
  const accountRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    findByPlatform: vi.fn(),
    findActiveByPlatform: vi.fn(),
    findByTags: vi.fn(),
    delete: vi.fn(),
    existsByIdentifier: vi.fn(),
  }
  const credentialStore = {
    store: vi.fn(),
    retrieve: vi.fn(),
    delete: vi.fn(),
  }
  const switchService = { switchAccount: vi.fn() } as unknown as ConstructorParameters<typeof AccountApplicationService>[2]
  const service = new AccountApplicationService(
    accountRepo as unknown as ConstructorParameters<typeof AccountApplicationService>[0],
    credentialStore as unknown as ConstructorParameters<typeof AccountApplicationService>[1],
    switchService,
  )

  beforeEach(() => {
    account = makeKiroAccount()
    accountRepo.findById.mockResolvedValue(account)
    accountRepo.save.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('replaces tags wholesale (supports both add + remove in one call)', async () => {
    await service.updateAccountMetadata('acc-1', { tags: ['new-a', 'new-b'] })
    expect([...account.tags.asSlice()]).toEqual(['new-a', 'new-b'])
    expect(accountRepo.save).toHaveBeenCalledOnce()
  })

  it('null name clears the name; non-null re-validates length', async () => {
    await service.updateAccountMetadata('acc-1', { name: null })
    expect(account.name).toBeUndefined()
    await service.updateAccountMetadata('acc-1', { name: 'Bob' })
    expect(account.name?.asStr()).toBe('Bob')
  })

  it('throws notFound when the account does not exist', async () => {
    accountRepo.findById.mockResolvedValueOnce(null)
    await expect(service.updateAccountMetadata('missing', { name: 'X' })).rejects.toBeInstanceOf(
      AccountError,
    )
  })
})

describe('AccountApplicationService.reauthenticate identity guard', () => {
  let account: Account
  const accountRepo = {
    findById: vi.fn(),
    save: vi.fn(),
    findByPlatform: vi.fn(),
    findActiveByPlatform: vi.fn(),
    findByTags: vi.fn(),
    delete: vi.fn(),
    existsByIdentifier: vi.fn(),
  }
  const credentialStore = {
    store: vi.fn(),
    retrieve: vi.fn(),
    delete: vi.fn(),
  }
  const switchService = { switchAccount: vi.fn() } as unknown as ConstructorParameters<typeof AccountApplicationService>[2]
  const service = new AccountApplicationService(
    accountRepo as unknown as ConstructorParameters<typeof AccountApplicationService>[0],
    credentialStore as unknown as ConstructorParameters<typeof AccountApplicationService>[1],
    switchService,
  )

  beforeEach(() => {
    account = makeKiroAccount()
    accountRepo.findById.mockResolvedValue(account)
    accountRepo.save.mockResolvedValue(undefined)
    credentialStore.store.mockResolvedValue(undefined)
  })

  afterEach(() => {
    vi.clearAllMocks()
  })

  it('replaces credentials when the new identity matches', async () => {
    await service.reauthenticate('acc-1', {
      identifier: 'alice@example.com',
      token: 'new-token',
    })
    expect(credentialStore.store).toHaveBeenCalledOnce()
    expect(credentialStore.store).toHaveBeenCalledWith(
      'acc-1',
      'kiro',
      expect.objectContaining({ token: 'new-token' }),
    )
  })

  it('rejects with an identity-mismatch error when the new identity differs', async () => {
    await expect(
      service.reauthenticate('acc-1', {
        identifier: 'bob@example.com',
        token: 'attacker-token',
      }),
    ).rejects.toBeInstanceOf(AccountError)
    expect(credentialStore.store).not.toHaveBeenCalled()
  })

  it('throws notFound when the account does not exist', async () => {
    accountRepo.findById.mockResolvedValueOnce(null)
    await expect(
      service.reauthenticate('missing', { identifier: 'x', token: 't' }),
    ).rejects.toBeInstanceOf(AccountError)
  })
})
