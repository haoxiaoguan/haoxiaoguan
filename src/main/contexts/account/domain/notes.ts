import { AccountError } from './account-error'
import { byteLen } from './account-name'

// Notes value object — max 256 bytes.
export class Notes {
  static readonly MAX_LENGTH = 256

  private readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(notes: string): Notes {
    const len = byteLen(notes)
    if (len > Notes.MAX_LENGTH) {
      throw AccountError.notesTooLong(Notes.MAX_LENGTH, len)
    }
    return new Notes(notes)
  }

  asStr(): string {
    return this.value
  }
}
