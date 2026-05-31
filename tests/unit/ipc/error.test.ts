import { describe, it, expect } from 'vitest'
import { toIpcError } from '../../../src/main/ipc/error'

describe('toIpcError', () => {
  it('extracts message from an Error', () => {
    expect(toIpcError(new Error('boom'))).toBe('boom')
  })
  it('passes through a string', () => {
    expect(toIpcError('already a string')).toBe('already a string')
  })
  it('stringifies unknown values', () => {
    expect(toIpcError({ code: 42 })).toContain('42')
  })
})
