import { execFile } from 'node:child_process'
import { promisify } from 'node:util'

const execFileAsync = promisify(execFile)

// macOS `security` CLI wrapper for the switch-injection ports (Gemini generic
// password, Zed internet password). Abstracted behind an interface so tests can
// inject a fake and non-macOS builds get a safe no-op (switch writes the on-disk
// files regardless; only the extra Keychain mirror is skipped).

export interface KeychainCommandRunner {
  /** Run `security <args>`. Rejects on non-zero exit. */
  run(args: string[]): Promise<void>
  /** Whether this runner actually touches a Keychain (false = no-op platform). */
  readonly available: boolean
}

class MacKeychainCommandRunner implements KeychainCommandRunner {
  readonly available = true
  async run(args: string[]): Promise<void> {
    await execFileAsync('security', args)
  }
}

class NoopKeychainCommandRunner implements KeychainCommandRunner {
  readonly available = false
  async run(_args: string[]): Promise<void> {
    // Non-macOS: no Keychain. Callers already persisted the on-disk credential.
  }
}

export function createKeychainCommandRunner(): KeychainCommandRunner {
  return process.platform === 'darwin'
    ? new MacKeychainCommandRunner()
    : new NoopKeychainCommandRunner()
}
