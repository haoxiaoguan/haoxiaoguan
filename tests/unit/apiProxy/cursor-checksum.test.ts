import { describe, it, expect } from 'vitest'
import {
  generateHashed64Hex,
  generateSessionId,
  uuidv5,
  generateCursorChecksum,
  buildCursorHeaders,
  cleanCursorToken,
} from '../../../src/main/contexts/apiProxy/infrastructure/adapters/cursor/cursor-checksum'

describe('cursor-checksum: uuidv5', () => {
  it('matches the canonical published DNS vector (python.org)', () => {
    // Python docs: uuid.uuid5(uuid.NAMESPACE_DNS, 'python.org')
    expect(uuidv5('python.org')).toBe('886313e1-3b8a-5372-9b90-0c9aee199e5d')
  })

  it('is deterministic and sets version 5 + RFC4122 variant', () => {
    const a = uuidv5('some-token')
    const b = uuidv5('some-token')
    expect(a).toBe(b)
    // version nibble
    expect(a[14]).toBe('5')
    // variant: first char of 4th group ∈ {8,9,a,b}
    expect('89ab').toContain(a[19])
  })

  it('generateSessionId delegates to uuidv5(token, DNS)', () => {
    expect(generateSessionId('tok')).toBe(uuidv5('tok'))
  })
})

describe('cursor-checksum: generateHashed64Hex', () => {
  it('produces a 64-char sha256 hex and honors salt', () => {
    const h = generateHashed64Hex('abc')
    expect(h).toMatch(/^[0-9a-f]{64}$/)
    // sha256("abc")
    expect(h).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad')
    expect(generateHashed64Hex('abc', 'salt')).not.toBe(h)
  })
})

describe('cursor-checksum: generateCursorChecksum (Jyh cipher)', () => {
  it('matches hand-computed known vector for a fixed clock', () => {
    // now = 1_700_000_000_000ms → timestamp = floor(now/1e6) = 1_700_000 (0x19F0A0)
    // 6-byte layout under JS shift semantics + Jyh cipher + url-safe base64 → "Vfb45Bi9"
    const checksum = generateCursorChecksum('MID', () => 1_700_000_000_000)
    expect(checksum).toBe('Vfb45Bi9MID')
  })

  it('appends machineId with no separator and is deterministic per clock', () => {
    const now = (): number => 1_700_000_000_000
    const a = generateCursorChecksum('machine-xyz', now)
    const b = generateCursorChecksum('machine-xyz', now)
    expect(a).toBe(b)
    expect(a.endsWith('machine-xyz')).toBe(true)
    expect(a).not.toContain(',')
  })
})

describe('cursor-checksum: cleanCursorToken', () => {
  it('strips user_xxx:: prefix, leaves bare JWT untouched', () => {
    expect(cleanCursorToken('user_01ABC::eyJhbGc.payload.sig')).toBe('eyJhbGc.payload.sig')
    expect(cleanCursorToken('eyJhbGc.payload.sig')).toBe('eyJhbGc.payload.sig')
  })
})

describe('cursor-checksum: buildCursorHeaders', () => {
  const fixedDeps = {
    now: (): number => 1_700_000_000_000,
    genUuid: (): string => '11111111-1111-1111-1111-111111111111',
    timezone: 'UTC',
  }

  it('produces the full Connect-RPC header set with derived credentials', () => {
    const h = buildCursorHeaders('user_1::JWTTOKEN', 'MID', true, fixedDeps)
    expect(h.authorization).toBe('Bearer JWTTOKEN')
    expect(h['content-type']).toBe('application/connect+proto')
    expect(h['connect-protocol-version']).toBe('1')
    expect(h['x-cursor-checksum']).toBe(generateCursorChecksum('MID', fixedDeps.now))
    expect(h['x-client-key']).toBe(generateHashed64Hex('JWTTOKEN'))
    expect(h['x-session-id']).toBe(generateSessionId('JWTTOKEN'))
    expect(h['x-ghost-mode']).toBe('true')
    expect(h['x-amzn-trace-id']).toBe('Root=11111111-1111-1111-1111-111111111111')
  })

  it('derives a machineId when none provided (SHA256(cleanToken+machineId))', () => {
    const h = buildCursorHeaders('JWTTOKEN', null, true, fixedDeps)
    const derived = generateHashed64Hex('JWTTOKEN', 'machineId')
    expect(h['x-cursor-checksum']).toBe(generateCursorChecksum(derived, fixedDeps.now))
  })

  it('honors ghostMode=false', () => {
    const h = buildCursorHeaders('JWTTOKEN', 'MID', false, fixedDeps)
    expect(h['x-ghost-mode']).toBe('false')
  })
})
