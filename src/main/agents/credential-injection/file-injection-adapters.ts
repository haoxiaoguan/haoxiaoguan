import { join } from 'node:path'
import { appSupportDir, dotDir } from '../../platform/persistence/paths'
import type { CredentialInjection, DecryptedCredential } from './credential-injection'
import {
  clearCredentialFile,
  injectCredentialToHostsJson,
  injectCredentialToJsonFile,
  injectCredentialToStorageJson,
} from './credential-io'
import { injectCursorAuthToVscdb } from './cursor-vscdb-inject'

// Per-platform credential-injection adapters. Faithful port of the Rust
// agents/infrastructure/adapters/<platform>.rs CredentialInjection impls.
//
// Three injection formats keyed by the canonical (snake_case) platform id:
//   - 'storage_json'  → VSCode family (merge storage.serviceMachineId)
//   - 'json_file'     → standalone {"token": ...}
//   - 'hosts_json'    → GitHub Copilot hosts.json
//   - 'cursor_vscdb'  → Cursor:写 state.vscdb 的 cursorAuth/*（Cursor 真正读这里，storage.json 无效）
//
// Paths come straight from the source credential_path() methods. Only the 12
// importable platforms have an injection adapter (matches source coverage).

type InjectionFormat = 'storage_json' | 'json_file' | 'hosts_json' | 'cursor_vscdb'

interface AdapterSpec {
  format: InjectionFormat
  path: () => string
}

const ADAPTER_SPECS: Record<string, AdapterSpec> = {
  cursor: {
    // Cursor 读 state.vscdb 的 cursorAuth/*，不读 storage.json —— 故用专用 vscdb 写入。
    format: 'cursor_vscdb',
    path: () => join(appSupportDir('Cursor'), 'User', 'globalStorage', 'state.vscdb'),
  },
  windsurf: {
    format: 'storage_json',
    path: () => join(appSupportDir('Windsurf'), 'User', 'globalStorage', 'storage.json'),
  },
  antigravity: {
    format: 'storage_json',
    path: () => join(appSupportDir('Antigravity'), 'User', 'globalStorage', 'storage.json'),
  },
  antigravity_ide: {
    format: 'storage_json',
    path: () => join(appSupportDir('Antigravity IDE'), 'User', 'globalStorage', 'storage.json'),
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
    // 真实数据目录是 "CodeBuddy CN"（带空格），对照 get_default_codebuddy_cn_data_dir。
    path: () => join(appSupportDir('CodeBuddy CN'), 'User', 'globalStorage', 'storage.json'),
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
      case 'cursor_vscdb':
        await injectCursorAuthToVscdb(credential, path)
        return
    }
  }

  // Source returns Ok(None) — extraction is not implemented.
  async extract(): Promise<DecryptedCredential | null> {
    return null
  }

  async clear(): Promise<void> {
    // cursor_vscdb 的 path 是 state.vscdb（Cursor 的全部本地状态库），绝不能整库删除；
    // 此处不支持「清除注入」（如需登出应只删 cursorAuth/* 键，另行实现）。
    if (this.spec.format === 'cursor_vscdb') return
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
