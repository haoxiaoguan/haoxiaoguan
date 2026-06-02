import { createDecipheriv, pbkdf2Sync } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { CredentialError } from '../domain/credential-error'

// VSCode SecretStorage decryption — SafeStorage logic (PBKDF2-HMAC-SHA1 +
// AES-128-CBC, v10/v11 prefix).
//
//   - macOS: key = PBKDF2-SHA1(safeStoragePassword, "saltysalt", 1003) → AES-128-CBC
//            v10 prefix. safeStoragePassword comes from `security
//            find-generic-password -w -s "<App> Safe Storage" [-a <account>]`.
//   - Linux: v11 = PBKDF2-SHA1(secret-tool lookup application <app>, salt, 1) ;
//            v10 = hardcoded LINUX_V10_KEY ; both fall back to LINUX_EMPTY_KEY.
//   - Windows: DPAPI not implemented → throws unsupported error.
//
// The CBC IV is 16 spaces (0x20). Padding is PKCS7. The encrypted SecretStorage
// value in state.vscdb may be a JSON Buffer ({type:'Buffer',data:[...]}) — the
// caller hands us the raw bytes; this module strips the prefix and decrypts.

const execFileAsync = promisify(execFile)

const SALT = Buffer.from('saltysalt', 'utf8')
const CBC_IV = Buffer.alloc(16, 0x20) // 16 spaces
const V10_PREFIX = Buffer.from('v10', 'utf8')
const V11_PREFIX = Buffer.from('v11', 'utf8')

// Linux hardcoded keys (LINUX_V10_KEY / LINUX_EMPTY_KEY).
const LINUX_V10_KEY = Buffer.from([
  0xfd, 0x62, 0x1f, 0xe5, 0xa2, 0xb4, 0x02, 0x53, 0x9d, 0xfa, 0x14, 0x7c, 0xa9, 0x27, 0x27, 0x78,
])
const LINUX_EMPTY_KEY = Buffer.from([
  0xd0, 0xd0, 0xec, 0x9c, 0x7d, 0x77, 0xd4, 0x3a, 0xc5, 0x41, 0x87, 0xfa, 0x48, 0x18, 0xd1, 0x7f,
])

/** SafeStorage "mode" — maps to the Keychain service/account candidates. */
export type SafeStorageMode = 'default' | 'codebuddy' | 'codebuddy_cn' | 'qoder'

export function pbkdf2Sha1Key(password: string, iterations: number): Buffer {
  return pbkdf2Sync(Buffer.from(password, 'utf8'), SALT, iterations, 16, 'sha1')
}

function decryptCbcPrefixed(encrypted: Buffer, expectedPrefix: Buffer, key: Buffer): Buffer {
  if (!encrypted.subarray(0, expectedPrefix.length).equals(expectedPrefix)) {
    throw CredentialError.storageError(
      `SecretStorage ciphertext prefix mismatch: ${encrypted.subarray(0, 3).toString()}`,
    )
  }
  const raw = encrypted.subarray(expectedPrefix.length)
  const decipher = createDecipheriv('aes-128-cbc', key, CBC_IV)
  decipher.setAutoPadding(true)
  return Buffer.concat([decipher.update(raw), decipher.final()])
}

function detectPrefix(encrypted: Buffer): 'v10' | 'v11' | null {
  if (encrypted.subarray(0, 3).equals(V10_PREFIX)) return 'v10'
  if (encrypted.subarray(0, 3).equals(V11_PREFIX)) return 'v11'
  return null
}

async function runCommandTrimmed(program: string, args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(program, args)
    const trimmed = stdout.trim()
    return trimmed.length > 0 ? trimmed : null
  } catch {
    return null
  }
}

// macOS Keychain service/account candidates per mode (mirrors
// macos_safe_storage_candidates). Each tuple is [service, account?].
function macosCandidates(mode: SafeStorageMode): Array<[string, string | undefined]> {
  switch (mode) {
    case 'codebuddy':
      return [
        ['CodeBuddy Safe Storage', 'CodeBuddy'],
        ['CodeBuddy Safe Storage', 'codebuddy'],
        ['CodeBuddy Safe Storage', 'CodeBuddy Key'],
        ['CodeBuddy Safe Storage', undefined],
      ]
    case 'codebuddy_cn':
      return [
        ['CodeBuddy CN Safe Storage', 'CodeBuddy CN'],
        ['CodeBuddy Safe Storage', 'CodeBuddy'],
        ['CodeBuddy Safe Storage', undefined],
      ]
    case 'qoder':
      return [
        ['Qoder Safe Storage', 'Qoder'],
        ['Qoder Safe Storage', undefined],
      ]
    default:
      // Default VSCode-family: the app supplies its own service name via the
      // adapter; the generic fallback uses the well-known "<App> Safe Storage".
      return [['Code Safe Storage', undefined]]
  }
}

async function macosSafeStoragePassword(mode: SafeStorageMode): Promise<string | null> {
  for (const [service, account] of macosCandidates(mode)) {
    if (account) {
      const withAccount = await runCommandTrimmed('security', [
        'find-generic-password',
        '-w',
        '-s',
        service,
        '-a',
        account,
      ])
      if (withAccount) return withAccount
    }
    const noAccount = await runCommandTrimmed('security', ['find-generic-password', '-w', '-s', service])
    if (noAccount) return noAccount
  }
  return null
}

async function linuxV11Key(): Promise<Buffer | null> {
  // Look up the secret service entry by application name; the default app for
  // VSCode-family SecretStorage is "code".
  const password = await runCommandTrimmed('secret-tool', ['lookup', 'application', 'code'])
  if (password === null) return null
  return pbkdf2Sha1Key(password, 1)
}

/**
 * Decrypt a VSCode SecretStorage encrypted byte blob into UTF-8 plaintext.
 * Throws CredentialError on unsupported platform / decrypt failure.
 */
export async function decryptSecretPayload(
  encrypted: Buffer,
  mode: SafeStorageMode = 'default',
): Promise<string> {
  if (process.platform === 'win32') {
    throw CredentialError.storageError(
      'Windows VS Code SecretStorage decryption is not implemented (DPAPI unsupported)',
    )
  }

  if (process.platform === 'darwin') {
    const password = await macosSafeStoragePassword(mode)
    if (password === null) {
      throw CredentialError.storageError('unable to read Safe Storage password from Keychain')
    }
    const key = pbkdf2Sha1Key(password, 1003)
    return decryptCbcPrefixed(encrypted, V10_PREFIX, key).toString('utf8')
  }

  // Linux
  const prefix = detectPrefix(encrypted)
  if (prefix === 'v11') {
    const key = (await linuxV11Key()) ?? null
    if (key) {
      try {
        return decryptCbcPrefixed(encrypted, V11_PREFIX, key).toString('utf8')
      } catch {
        // fall through to empty key
      }
    }
    return decryptCbcPrefixed(encrypted, V11_PREFIX, LINUX_EMPTY_KEY).toString('utf8')
  }
  if (prefix === 'v10') {
    try {
      return decryptCbcPrefixed(encrypted, V10_PREFIX, LINUX_V10_KEY).toString('utf8')
    } catch {
      return decryptCbcPrefixed(encrypted, V10_PREFIX, LINUX_EMPTY_KEY).toString('utf8')
    }
  }
  throw CredentialError.storageError(
    `unsupported SecretStorage ciphertext prefix: ${encrypted.subarray(0, 3).toString()}`,
  )
}

/**
 * Decode a state.vscdb SecretStorage value. The stored value may be:
 *   - a JSON object { data: number[] } (Buffer) → decrypt,
 *   - a JSON object with a string body → return it,
 *   - a plain string → return it.
 */
export async function decodeSecretStorageValue(
  rawValue: string,
  mode: SafeStorageMode = 'default',
): Promise<string> {
  let parsed: unknown
  try {
    parsed = JSON.parse(rawValue)
  } catch {
    return rawValue
  }

  if (parsed && typeof parsed === 'object' && 'data' in (parsed as Record<string, unknown>)) {
    const dataArr = (parsed as { data: unknown }).data
    if (!Array.isArray(dataArr)) {
      throw CredentialError.storageError('secret Buffer missing data array')
    }
    const bytes = Buffer.alloc(dataArr.length)
    for (let i = 0; i < dataArr.length; i++) {
      const n = dataArr[i]
      if (typeof n !== 'number' || n < 0 || n > 255) {
        throw CredentialError.storageError(`secret Buffer entry ${i} out of byte range`)
      }
      bytes[i] = n
    }
    return decryptSecretPayload(bytes, mode)
  }

  if (typeof parsed === 'string') return parsed
  return rawValue
}
