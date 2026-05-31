import { describe, it, expect } from 'vitest'
import { AccountName } from '../../../src/main/contexts/account/domain/account-name'
import { Notes } from '../../../src/main/contexts/account/domain/notes'
import { Tags } from '../../../src/main/contexts/account/domain/tags'
import { AccountError } from '../../../src/main/contexts/account/domain/account-error'

describe('AccountName', () => {
  it('accepts up to 64 bytes', () => {
    const name = AccountName.create('a'.repeat(64))
    expect(name.asStr().length).toBe(64)
  })

  it('rejects 65+ bytes with NameTooLong', () => {
    try {
      AccountName.create('a'.repeat(65))
      throw new Error('expected throw')
    } catch (e) {
      expect(e).toBeInstanceOf(AccountError)
      expect((e as AccountError).kind).toBe('NameTooLong')
      expect((e as AccountError).message).toBe('Name too long: max 64 characters, got 65')
    }
  })

  it('allows empty', () => {
    expect(AccountName.create('').asStr()).toBe('')
  })
})

describe('Notes', () => {
  it('accepts up to 256 bytes', () => {
    expect(Notes.create('a'.repeat(256)).asStr().length).toBe(256)
  })

  it('rejects 257 bytes with NotesTooLong', () => {
    expect(() => Notes.create('a'.repeat(257))).toThrowError(
      'Notes too long: max 256 characters, got 257',
    )
  })
})

describe('Tags', () => {
  it('accepts up to 10 tags each up to 32 bytes', () => {
    const tags = Tags.create(Array.from({ length: 10 }, () => 'a'.repeat(32)))
    expect(tags.length).toBe(10)
  })

  it('rejects 11 tags with TooManyTags', () => {
    try {
      Tags.create(Array.from({ length: 11 }, (_v, i) => `tag${i}`))
      throw new Error('expected throw')
    } catch (e) {
      expect((e as AccountError).kind).toBe('TooManyTags')
      expect((e as AccountError).message).toBe('Too many tags: max 10, got 11')
    }
  })

  it('rejects a 33-byte tag with TagTooLong', () => {
    expect(() => Tags.create(['a'.repeat(33)])).toThrowError(
      'Tag too long: max 32 characters, got 33',
    )
  })

  it('add() enforces count and length', () => {
    const tags = Tags.create(Array.from({ length: 10 }, (_v, i) => `tag${i}`))
    expect(() => tags.add('overflow')).toThrowError('Too many tags: max 10, got 11')

    const empty = Tags.create([])
    expect(() => empty.add('a'.repeat(33))).toThrowError('Tag too long: max 32 characters, got 33')
    empty.add('ok')
    expect(empty.length).toBe(1)
  })
})
