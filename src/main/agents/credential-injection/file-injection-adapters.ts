import { join } from 'node:path'
import { appSupportDir, dotDir } from '../../platform/persistence/paths'
import type { CredentialInjection, DecryptedCredential } from './credential-injection'
import {
  clearCredentialFile,
  injectCredentialToHostsJson,
  injectCredentialToJsonFile,
  injectCredentialToStorageJson,
} from './credential-io'

// Per-platform credential-injection adapters. Faithful port of the Rust
// agents/infrastructure/adapters/<platform>.rs CredentialInjection impls.
//
// Three injection formats keyed by the canonical (snake_case) platform id:
//   - 'storage_json'  → VSCode family (merge storage.serviceMachineId)
//   - 'json_file'     → standalone {"token": ...}
//   - 'hosts_json'    → GitHub Copilot hosts.json
//
// Paths come straight from the source credential_path() methods. Only the 12
// importable platforms have an injection adapter (matches source coverage).

type InjectionFormat = 'storage_json' | 'json_file' | 'hosts_json'

interface AdapterSpec {
  format: InjectionFormat
  path: () => string
}

const ADAPTER_SPECS: Record<string, AdapterSpec> = {
  cursor: {
    format: 'storage_json',
    path: () => join(appSupportDir('Cursor'), 'User', 'globalStorage', 'storage.json'),
  },
  windsurf: {
    format: 'storage_json',
    path: () => join(appSupportDir('Windsurf'), 'User', 'globalStorage', 'storage.json'),
  },
  antigravity: {
    format: 'storage_json',
    path: () => join(appSupportDir('Antigravity'), 'User', 'globalStorage', 'storage.json'),
  },
  kiro: {
    format: 'storage_json',
    path: () => join(appSupportDir('Kiro'), 'User', 'globalStorage', 'storage.json'),
  },
  trae: {
    format: 'storage_json',
    path: () => join(appSupportDir('Trae'), 'User', 'globalStorage', 'storage.json'),
  },
  codebuddy: {
    format: 'storage_json',
    path: () => join(appSupportDir('CodeBuddy'), 'User', 'globalStorage', 'storage.json'),
  },
  codebuddy_cn: {
    format: 'storage_json',
    path: () => join(appSupportDir('CodeBuddyCN'), 'User', 'globalStorage', 'storage.json'),
  },
  qoder: {
    format: 'json_file',
    path: () => join(appSupportDir('Qoder'), 'credentials.json'),
  },
  github_copilot: {
    format: 'hosts_json',
    path: () => join(dotDir('config'), 'github-copilot', 'hosts.json'),
  },
  codex: {
    format: 'json_file',
    path: () => join(dotDir('codex'), 'auth.json'),
  },
  gemini_cli: {
    format: 'json_file',
    path: () => join(dotDir('gemini'), 'auth.json'),
  },
  zed: {
    format: 'json_file',
    path: () => join(dotDir('zed'), 'credentials.json'),
  },
}

export class FileCredentialInjectionAdapter implements CredentialInjection {
  constructor(private readonly spec: AdapterSpec) {}

  async inject(credential: DecryptedCredential): Promise<void> {
    const path = this.credentialPath()
    switch (this.spec.format) {
      case 'storage_json':
        await injectCredentialToStorageJson(credential.token, path)
        return
      case 'json_file':
        await injectCredentialToJsonFile(credential.token, path)
        return
      case 'hosts_json':
        await injectCredentialToHostsJson(credential.token, path)
        return
    }
  }

  // Source returns Ok(None) — extraction is not implemented.
  async extract(): Promise<DecryptedCredential | null> {
    return null
  }

  async clear(): Promise<void> {
    await clearCredentialFile(this.credentialPath())
  }

  credentialPath(): string {
    return this.spec.path()
  }
}

/** Build the injection adapter for a platform, or undefined if unsupported. */
export function makeInjectionAdapter(platform: string): FileCredentialInjectionAdapter | undefined {
  const spec = ADAPTER_SPECS[platform]
  return spec ? new FileCredentialInjectionAdapter(spec) : undefined
}

/** All platform ids that have an injection adapter (the 12 importable). */
export function injectionSupportedPlatforms(): string[] {
  return Object.keys(ADAPTER_SPECS)
}
