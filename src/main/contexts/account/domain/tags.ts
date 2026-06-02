import { AccountError } from './account-error'
import { byteLen } from './account-name'

// Tags value object — max 10 tags, each max 32 bytes.
export class Tags {
  static readonly MAX_COUNT = 10
  static readonly MAX_TAG_LENGTH = 32

  private readonly values: string[]

  private constructor(values: string[]) {
    this.values = values
  }

  static create(tags: string[]): Tags {
    if (tags.length > Tags.MAX_COUNT) {
      throw AccountError.tooManyTags(Tags.MAX_COUNT, tags.length)
    }
    for (const tag of tags) {
      const len = byteLen(tag)
      if (len > Tags.MAX_TAG_LENGTH) {
        throw AccountError.tagTooLong(Tags.MAX_TAG_LENGTH, len)
      }
    }
    return new Tags([...tags])
  }

  add(tag: string): void {
    const len = byteLen(tag)
    if (len > Tags.MAX_TAG_LENGTH) {
      throw AccountError.tagTooLong(Tags.MAX_TAG_LENGTH, len)
    }
    if (this.values.length >= Tags.MAX_COUNT) {
      throw AccountError.tooManyTags(Tags.MAX_COUNT, this.values.length + 1)
    }
    this.values.push(tag)
  }

  /**
   * Replace the entire tag set in place. Validates each new tag against the
   * same length / count invariants as the factory. Used by Account.editMetadata
   * so the aggregate's Tags reference stays stable while contents are swapped.
   */
  replaceAll(tags: string[]): void {
    if (tags.length > Tags.MAX_COUNT) {
      throw AccountError.tooManyTags(Tags.MAX_COUNT, tags.length)
    }
    for (const tag of tags) {
      const len = byteLen(tag)
      if (len > Tags.MAX_TAG_LENGTH) {
        throw AccountError.tagTooLong(Tags.MAX_TAG_LENGTH, len)
      }
    }
    this.values.length = 0
    for (const tag of tags) this.values.push(tag)
  }

  asSlice(): readonly string[] {
    return this.values
  }

  isEmpty(): boolean {
    return this.values.length === 0
  }

  get length(): number {
    return this.values.length
  }
}
