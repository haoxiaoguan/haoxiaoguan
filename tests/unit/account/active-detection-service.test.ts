import { describe, it, expect } from 'vitest'
import { ActiveDetectionService } from '../../../src/main/contexts/account/application/active-detection-service'
import type { PlatformId } from '../../../src/main/contexts/account/domain/platform-id'
import type { ImportedCredentialMaterial } from '../../../src/main/contexts/credential/domain/capability-types'

// A minimal Account stand-in tracking isActive + a settable identityKey. The
// detector only reads id/identityKey/isActive and calls activate/deactivate.
function acc(id: string, identityKey: string, isActive = false) {
  const a = {
    id,
    identityKey,
    _isActive: isActive,
    get isActive() {
      return a._isActive
    },
    activate() {
      a._isActive = true
    },
    deactivate() {
      a._isActive = false
    },
  }
  return a
}

type FakeAccount = ReturnType<typeof acc>

// Fake repo: only findByPlatform + save are used by the detector.
function fakeRepo(byPlatform: Partial<Record<PlatformId, FakeAccount[]>>) {
  const saved: string[] = []
  return {
    repo: {
      findByPlatform: async (p: PlatformId) => (byPlatform[p] ?? []) as never,
      save: async (a: FakeAccount) => {
        saved.push(a.id)
      },
      // unused
      findById: async () => null as never,
      findActiveByPlatform: async () => null as never,
      findByTags: async () => [] as never,
      delete: async () => {},
      existsByIdentifier: async () => false,
    },
    saved,
  }
}

// Fake import service: scanLocal returns scripted materials (or throws).
function fakeImport(byPlatform: Partial<Record<PlatformId, ImportedCredentialMaterial[] | 'throw'>>) {
  return {
    scanLocal: async (p: PlatformId) => {
      const v = byPlatform[p]
      if (v === 'throw') throw new Error('locked db')
      return (v ?? []) as ImportedCredentialMaterial[]
    },
  } as never
}

// A cursor material whose derived identityKey we can predict. cursorProfile uses
// the authId (sub) → identityKey = sanitize(authId). We embed authId in rawMetadata.
function cursorMaterial(authId: string, email = 'u@example.com'): ImportedCredentialMaterial {
  return {
    provider: 'cursor',
    email,
    accessToken: 'opaque',
    source: 'local_scan',
    rawMetadata: { email, auth_id: authId, cursor_auth_raw: { accessToken: 'opaque', cachedEmail: email, authId } },
  }
}

describe('ActiveDetectionService', () => {
  it('moves the active flag to the account the IDE is actually using', async () => {
    const a = acc('a', 'auth0-alice', true) // currently active in-app
    const b = acc('b', 'auth0-bob', false) // but the IDE is logged into bob
    const { repo, saved } = fakeRepo({ cursor: [a, b] })
    const svc = new ActiveDetectionService(
      repo as never,
      fakeImport({ cursor: [cursorMaterial('auth0|bob')] }),
      ['cursor'],
    )
    const out = await svc.detectAll()
    expect(a.isActive).toBe(false)
    expect(b.isActive).toBe(true)
    expect(out[0]).toEqual({ platform: 'cursor', activeAccountId: 'b', matched: true })
    expect(saved.sort()).toEqual(['a', 'b'])
  })

  it('does nothing when the detected account is already active', async () => {
    const a = acc('a', 'auth0-alice', true)
    const { repo, saved } = fakeRepo({ cursor: [a] })
    const svc = new ActiveDetectionService(
      repo as never,
      fakeImport({ cursor: [cursorMaterial('auth0|alice')] }),
      ['cursor'],
    )
    const out = await svc.detectAll()
    expect(a.isActive).toBe(true)
    expect(saved).toEqual([]) // no write
    expect(out[0]).toEqual({ platform: 'cursor', activeAccountId: 'a', matched: true })
  })

  it('clears a stale active when the IDE is logged into an un-imported identity', async () => {
    const a = acc('a', 'auth0-alice', true)
    const { repo, saved } = fakeRepo({ cursor: [a] })
    const svc = new ActiveDetectionService(
      repo as never,
      fakeImport({ cursor: [cursorMaterial('auth0|stranger')] }),
      ['cursor'],
    )
    const out = await svc.detectAll()
    expect(a.isActive).toBe(false) // deactivated — real login isn't a tracked account
    expect(saved).toEqual(['a'])
    expect(out[0]).toEqual({ platform: 'cursor', activeAccountId: null, matched: false })
  })

  it('is conservative: an unreadable local state leaves isActive untouched', async () => {
    const a = acc('a', 'auth0-alice', true)
    const { repo, saved } = fakeRepo({ cursor: [a] })
    // empty scan AND throwing scan both = unreadable → no change.
    const svcEmpty = new ActiveDetectionService(repo as never, fakeImport({ cursor: [] }), ['cursor'])
    const out1 = await svcEmpty.detectAll()
    expect(a.isActive).toBe(true)
    expect(saved).toEqual([])
    expect(out1[0]).toEqual({ platform: 'cursor', activeAccountId: 'a', matched: false })

    const svcThrow = new ActiveDetectionService(repo as never, fakeImport({ cursor: 'throw' }), ['cursor'])
    const out2 = await svcThrow.detectAll()
    expect(a.isActive).toBe(true)
    expect(saved).toEqual([])
    expect(out2[0]).toEqual({ platform: 'cursor', activeAccountId: 'a', matched: false })
  })

  it('isolates failures across platforms (one bad platform does not abort the rest)', async () => {
    const c = acc('c', 'auth0-carol', false)
    const { repo } = fakeRepo({ cursor: [c], kiro: [] })
    const svc = new ActiveDetectionService(
      repo as never,
      fakeImport({ cursor: [cursorMaterial('auth0|carol')], kiro: 'throw' }),
      ['cursor', 'kiro'],
    )
    const out = await svc.detectAll()
    expect(c.isActive).toBe(true) // cursor still processed
    const cursorRes = out.find((r) => r.platform === 'cursor')
    const kiroRes = out.find((r) => r.platform === 'kiro')
    expect(cursorRes).toEqual({ platform: 'cursor', activeAccountId: 'c', matched: true })
    // kiro: throwing scan is conservative (no active to report) → null/false, no crash.
    expect(kiroRes).toEqual({ platform: 'kiro', activeAccountId: null, matched: false })
  })
})
