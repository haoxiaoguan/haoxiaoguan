import { describe, it, expect } from 'vitest'
import { AgentCapabilities, parseCapability, ALL_CAPABILITIES } from '../../../src/main/agents/domain/capability'

describe('AgentCapabilities (bitmask value object)', () => {
  it('none() has no capabilities and an empty list', () => {
    const caps = AgentCapabilities.none()
    expect(caps.has('credential')).toBe(false)
    expect(caps.has('skills')).toBe(false)
    expect(caps.has('mcp')).toBe(false)
    expect(caps.has('session_log')).toBe(false)
    expect(caps.list()).toEqual([])
  })

  it('with() adds a capability immutably (returns a new instance)', () => {
    const base = AgentCapabilities.none()
    const withCred = base.with('credential')
    expect(base.has('credential')).toBe(false) // original unchanged
    expect(withCred.has('credential')).toBe(true)
  })

  it('chained with() composes multiple capabilities', () => {
    const caps = AgentCapabilities.none().with('credential').with('session_log')
    expect(caps.has('credential')).toBe(true)
    expect(caps.has('session_log')).toBe(true)
    expect(caps.has('skills')).toBe(false)
    expect(caps.list()).toEqual(['credential', 'session_log'])
  })

  it('of() builds from a set and list() is in canonical order', () => {
    // Provide out of canonical order; list() must still be canonical.
    const caps = AgentCapabilities.of('mcp', 'credential', 'session_log', 'skills')
    expect(caps.list()).toEqual([...ALL_CAPABILITIES])
  })
})

describe('parseCapability', () => {
  it('accepts every known capability', () => {
    for (const c of ALL_CAPABILITIES) {
      expect(parseCapability(c)).toBe(c)
    }
  })

  it('throws on an unknown capability', () => {
    expect(() => parseCapability('bogus')).toThrow("unknown capability: 'bogus'")
  })
})
