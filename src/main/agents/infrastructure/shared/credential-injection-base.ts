// Shared CredentialInjection implementation — mirrors the identical inject/
// extract/clear/credential_path pattern repeated across all credential adapters
// in the Rust source. Each adapter supplies its credential path and the
// concrete write strategy (storage.json merge, {token} json, or hosts.json).

import { existsSync } from 'node:fs'
import { rm } from 'node:fs/promises'
import { AgentError } from '../../domain/agent-error'
import type { CredentialInjection, DecryptedCredential } from '../../domain/credential-injection'
import {
  injectCredentialToStorageJson,
  injectCredentialToJsonFile,
  injectCredentialToHostsJson,
} from './credential-io'

export type CredentialFormat = 'storage_json' | 'token_json' | 'hosts_json'

/** Concrete CredentialInjection bound to a path + on-disk format. */
export class FileCredentialInjection implements CredentialInjection {
  constructor(
    private readonly path: string,
    private readonly format: CredentialFormat,
  ) {}

  credentialPath(): string {
    return this.path
  }

  async inject(credential: DecryptedCredential): Promise<void> {
    const { token } = credential
    switch (this.format) {
      case 'storage_json':
        return injectCredentialToStorageJson(token, this.path)
      case 'token_json':
        return injectCredentialToJsonFile(token, this.path)
      case 'hosts_json':
        return injectCredentialToHostsJson(token, this.path)
    }
  }

  // Read-back not yet implemented in the source — returns null for all adapters.
  async extract(): Promise<DecryptedCredential | null> {
    return null
  }

  async clear(): Promise<void> {
    if (!existsSync(this.path)) return
    try {
      await rm(this.path, { force: true })
    } catch (e) {
      throw AgentError.filesystem(this.path, e)
    }
  }
}
