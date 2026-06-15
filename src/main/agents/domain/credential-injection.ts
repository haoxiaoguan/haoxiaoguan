// CredentialInjection capability interface — mirrors Rust
// agents::domain::credential_injection. Each credential-capable adapter
// implements this to write/clear a token into the agent's on-disk config.

import type { AgentError } from './agent-error'

/**
 * Decrypted credential passed in from the credential module.
 * agents/ does NOT own decryption — it only writes the plaintext token to disk.
 * Mirrors Rust DecryptedCredential { token, refresh_token, metadata }.
 */
export interface DecryptedCredential {
  token: string
  refreshToken?: string | undefined
  metadata?: string | undefined
}

export interface CredentialInjection {
  /** Absolute path to the credential file this adapter manages. */
  credentialPath(): string
  /** Write the credential to disk, creating parent dirs as needed. */
  inject(credential: DecryptedCredential): Promise<void>
  /**
   * Read the credential back. Currently returns null for all adapters
   * (read-back not yet implemented in the source). Throws {@link AgentError}.
   */
  extract(): Promise<DecryptedCredential | null>
  /** Remove the credential file. No-op if the file does not exist. */
  clear(): Promise<void>
}

// Re-export AgentError type position for adapter authors' convenience.
export type { AgentError }
