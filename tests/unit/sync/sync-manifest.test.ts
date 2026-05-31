import { describe, it, expect } from 'vitest'
import {
  SyncManifest,
  MANIFEST_FORMAT,
  MANIFEST_VERSION,
  sha256Hex,
} from '../../../src/main/contexts/sync/domain/sync-manifest'
import { SyncError } from '../../../src/main/contexts/sync/domain/sync-error'

describe('SyncManifest', () => {
  it('builds with sha256 + size per artifact and round-trips JSON', () => {
    const db = Buffer.from('INSERT INTO x VALUES(1);\n', 'utf8')
    const skills = Buffer.from([1, 2, 3, 4])
    const m = SyncManifest.build('dev-1', 1_730_000_000, [
      ['db.sql', db],
      ['skills.zip', skills],
    ])
    expect(m.format).toBe(MANIFEST_FORMAT)
    expect(m.version).toBe(MANIFEST_VERSION)
    expect(m.artifacts.get('db.sql')).toEqual({ sha256: sha256Hex(db), size: db.length })

    const parsed = SyncManifest.fromJsonBytes(m.toJsonBytes())
    expect(parsed.deviceName).toBe('dev-1')
    expect(parsed.createdAt).toBe(1_730_000_000)
    expect(parsed.artifacts.get('skills.zip')?.size).toBe(4)
  })

  it('serializes artifact keys in deterministic sorted order', () => {
    const m = SyncManifest.build('dev', 1, [
      ['skills.zip', Buffer.from('b')],
      ['db.sql', Buffer.from('a')],
      ['master.key.enc', Buffer.from('c')],
    ])
    const json = m.toJsonBytes().toString('utf8')
    const dbIdx = json.indexOf('db.sql')
    const masterIdx = json.indexOf('master.key.enc')
    const skillsIdx = json.indexOf('skills.zip')
    expect(dbIdx).toBeLessThan(masterIdx)
    expect(masterIdx).toBeLessThan(skillsIdx)
  })

  it('validateCompat rejects a bad format', () => {
    const bad = SyncManifest.fromJsonBytes(
      Buffer.from(
        JSON.stringify({ format: 'other', version: 1, deviceName: 'd', createdAt: 0, artifacts: {} }),
        'utf8',
      ),
    )
    expect(() => bad.validateCompat()).toThrow(SyncError)
  })

  it('validateCompat throws versionIncompatible on version mismatch', () => {
    const bad = SyncManifest.fromJsonBytes(
      Buffer.from(
        JSON.stringify({
          format: MANIFEST_FORMAT,
          version: 99,
          deviceName: 'd',
          createdAt: 0,
          artifacts: {},
        }),
        'utf8',
      ),
    )
    try {
      bad.validateCompat()
      throw new Error('should have thrown')
    } catch (e) {
      expect(e).toBeInstanceOf(SyncError)
      expect((e as SyncError).kind).toBe('versionIncompatible')
    }
  })

  it('verifyArtifact passes for matching bytes and fails on tamper', () => {
    const bytes = Buffer.from('hello world')
    const m = SyncManifest.build('d', 0, [['db.sql', bytes]])
    expect(() => m.verifyArtifact('db.sql', bytes)).not.toThrow()
    expect(() => m.verifyArtifact('db.sql', Buffer.from('tampered'))).toThrow(SyncError)
    expect(() => m.verifyArtifact('missing.bin', bytes)).toThrow(SyncError)
  })
})
