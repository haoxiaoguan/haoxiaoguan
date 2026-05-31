// CredentialInjection capability — mirrors Rust agents::domain::credential_injection.
//
// Each credential-capable agent adapter implements this: it writes a decrypted
// credential into the target IDE's on-disk config file and resolves that file's
// per-OS path itself.

export interface DecryptedCredential {
  token: string
  refreshToken?: string
  metadata?: string
}

export interface CredentialInjection {
  /** Write the credential into the agent's config file (atomic). */
  inject(credential: DecryptedCredential): Promise<void>
  /** Extract an existing credential (not implemented in source — returns null). */
  extract(): Promise<DecryptedCredential | null>
  /** Remove the credential file. */
  clear(): Promise<void>
  /** Absolute path to the agent's credential file. */
  credentialPath(): string
}
