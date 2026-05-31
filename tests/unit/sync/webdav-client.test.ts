import { describe, it, expect } from 'vitest'
import {
  buildRemoteUrl,
  authFromCredentials,
} from '../../../src/main/contexts/sync/domain/webdav-client'
import { redactUrl } from '../../../src/main/contexts/sync/infrastructure/fetch-webdav-client'
import { WebdavConfig } from '../../../src/main/contexts/sync/domain/webdav-config'
import { SyncError } from '../../../src/main/contexts/sync/domain/sync-error'

describe('webdav-client url + auth helpers', () => {
  it('builds a remote URL from base + percent-encoded segments', () => {
    expect(buildRemoteUrl('https://dav.example.com/dav/', ['root', 'v1', 'a b'])).toBe(
      'https://dav.example.com/dav/root/v1/a%20b',
    )
  })

  it('skips empty segments and trims trailing slashes', () => {
    expect(buildRemoteUrl('https://h/dav///', ['', 'x', ''])).toBe('https://h/dav/x')
  })

  it('rejects an empty / non-http base url', () => {
    expect(() => buildRemoteUrl('', ['x'])).toThrow(SyncError)
    expect(() => buildRemoteUrl('ftp://h/x', ['y'])).toThrow(SyncError)
  })

  it('authFromCredentials returns null for an empty username', () => {
    expect(authFromCredentials('  ', 'pw')).toBeNull()
    expect(authFromCredentials('alice', 'pw')).toEqual({ username: 'alice', password: 'pw' })
  })
})

describe('redactUrl', () => {
  it('strips credentials and query values, keeps sorted keys', () => {
    expect(redactUrl('https://alice:secret@dav.example.com:8443/dav?token=abc&foo=1')).toBe(
      'https://dav.example.com:8443/dav?[keys:foo,token]',
    )
  })

  it('handles a url with no query', () => {
    expect(redactUrl('https://user:pw@host.com/path/to/file')).toBe(
      'https://host.com/path/to/file',
    )
  })
})

describe('WebdavConfig value object', () => {
  it('applies serde-style defaults for missing keys', () => {
    const cfg = WebdavConfig.fromJson({})
    expect(cfg.enabled).toBe(false)
    expect(cfg.remoteRoot).toBe('haoxiaoguan-sync')
    expect(cfg.profile).toBe('default')
    expect(cfg.autoSync).toBe(false)
  })

  it('round-trips toJson with the status block and no password fields', () => {
    const cfg = WebdavConfig.fromJson({
      enabled: true,
      baseUrl: 'https://h/dav',
      username: 'alice',
      remoteRoot: 'r',
      profile: 'p',
      autoSync: true,
      status: { lastSyncAt: 123, lastErrorSource: 'manual' },
    })
    const json = cfg.toJson()
    expect(json).not.toHaveProperty('password')
    expect(json.status.lastSyncAt).toBe(123)
    expect(json.status.lastErrorSource).toBe('manual')
    // invalid source coerces to null
    const bad = WebdavConfig.fromJson({ status: { lastErrorSource: 'weird' } })
    expect(bad.status.lastErrorSource).toBeNull()
  })

  it('assertValidBaseUrl enforces http(s) scheme', () => {
    expect(() => WebdavConfig.fromJson({ baseUrl: 'https://h' }).assertValidBaseUrl()).not.toThrow()
    expect(() => WebdavConfig.fromJson({ baseUrl: '' }).assertValidBaseUrl()).toThrow()
    expect(() => WebdavConfig.fromJson({ baseUrl: 'ftp://h' }).assertValidBaseUrl()).toThrow()
  })
})
