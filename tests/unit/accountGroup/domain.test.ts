import { describe, expect, it } from 'vitest'
import {
  AccountGroupError,
  normalizeAccountGroupColor,
  normalizeAccountGroupDescription,
  normalizeAccountGroupName,
} from '../../../src/main/contexts/accountGroup/domain/account-group'

describe('AccountGroup domain normalizers', () => {
  it('normalizeAccountGroupName trims and rejects empty / over-long values', () => {
    expect(normalizeAccountGroupName('  hello  ')).toBe('hello')
    expect(() => normalizeAccountGroupName('  ')).toThrow(AccountGroupError)
    // 64 bytes is the cap; 65 ASCII chars must reject.
    expect(() => normalizeAccountGroupName('x'.repeat(65))).toThrow(AccountGroupError)
  })

  it('normalizeAccountGroupColor lowercases hex and rejects bad tokens', () => {
    expect(normalizeAccountGroupColor('#0EA5E9')).toBe('#0ea5e9')
    expect(normalizeAccountGroupColor('')).toBeUndefined()
    expect(normalizeAccountGroupColor(undefined)).toBeUndefined()
    expect(() => normalizeAccountGroupColor('blue')).toThrow(AccountGroupError)
    expect(() => normalizeAccountGroupColor('#fff')).toThrow(AccountGroupError) // 3-digit not allowed
  })

  it('normalizeAccountGroupDescription enforces 256-byte cap', () => {
    expect(normalizeAccountGroupDescription('  hi  ')).toBe('hi')
    expect(normalizeAccountGroupDescription('')).toBeUndefined()
    expect(() => normalizeAccountGroupDescription('a'.repeat(257))).toThrow(AccountGroupError)
  })
})
