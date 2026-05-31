import { AccountError } from './account-error'

// Shared UTF-8 byte length helper. Rust's String::len() counts bytes, not chars,
// so the value-object length invariants are byte-based. TextEncoder is a Web/Node
// standard (no Node-specific import), keeping the domain layer pure.
const encoder = new TextEncoder()
export function byteLen(value: string): number {
  return encoder.encode(value).length
}

// AccountName value object — max 64 bytes. 对应 AccountName.
export class AccountName {
  static readonly MAX_LENGTH = 64

  private readonly value: string

  private constructor(value: string) {
    this.value = value
  }

  static create(name: string): AccountName {
    const len = byteLen(name)
    if (len > AccountName.MAX_LENGTH) {
      throw AccountError.nameTooLong(AccountName.MAX_LENGTH, len)
    }
    return new AccountName(name)
  }

  asStr(): string {
    return this.value
  }
}
