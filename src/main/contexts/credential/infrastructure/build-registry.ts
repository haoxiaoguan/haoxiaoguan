import { type PlatformId } from '../../account/domain/platform-id'
import { ProviderRegistry } from '../domain/provider-registry'
import { CursorLocalImportCapability } from './capabilities/cursor-local-import'
import { CodexLocalImportCapability } from './capabilities/codex-local-import'
import { CursorOAuthCapability } from './capabilities/cursor-oauth'
import { KiroOAuthCapability } from './capabilities/kiro-oauth'
import { GitHubCopilotOAuthCapability } from './capabilities/github-copilot-oauth'
import { TokenJsonFileImportCapability } from './capabilities/token-json-file-import'
import { DeepLinkImportCapabilityImpl } from './capabilities/deep-link-import'
import {
  VsCodeSecretLocalImportCapability,
  type VsCodeSecretScanConfig,
} from './capabilities/vscode-secret-local-import'

// build-registry — assembles the credential ProviderRegistry. 对应
// build_default_registry: register the real capabilities, leaving providers
// without an implementation to surface a typed UnsupportedSource error from the
// services (the source uses explicit stubs; here an absent map entry is the
// equivalent and avoids dead stub objects).
//
// Implemented for real:
//   - OAuth:        cursor (poll), kiro (loopback), github_copilot (device flow)
//   - LocalScan:    cursor (state.vscdb), codex (auth.json), + VSCode-family
//                   SecretStorage (windsurf, kiro, qoder, trae, codebuddy,
//                   codebuddy_cn, antigravity) via generic decrypt reader
//   - TokenJson:    all 12 importable providers (generic normaliser)
//   - DeepLink:     all 12 importable providers (haoxiaoguan://import/... parser)
//
// OAuth for windsurf/trae/zed/qoder/codebuddy(_cn)/gemini/codex is NOT ported
// (their authorize URLs / token endpoints carry provider-specific client ids and
// signing the source obtains from live endpoints) — those start_oauth calls
// surface UnsupportedSource until ported. See manifest TODO(verify).

// The 12 importable platforms (commands.rs parse_platform set).
const IMPORTABLE: readonly PlatformId[] = [
  'cursor',
  'windsurf',
  'antigravity',
  'kiro',
  'github_copilot',
  'codex',
  'gemini_cli',
  'codebuddy',
  'codebuddy_cn',
  'qoder',
  'trae',
  'zed',
]

// VSCode-family SecretStorage scan configs. The extension-id/secret-key values
// mirror the source local scanners where known; entries marked TODO(verify)
// use the best-known shape and should be confirmed against a live install.
const VSCODE_SECRET_CONFIGS: VsCodeSecretScanConfig[] = [
  // TODO(verify): exact extensionId/secretKey per provider against a live install.
  { platform: 'windsurf', appDir: 'Windsurf', extensionId: 'codeium.windsurf', secretKey: 'windsurf.auth', mode: 'default' },
  { platform: 'kiro', appDir: 'Kiro', extensionId: 'kiro.kiroagent', secretKey: 'kiro.kiroAgent', mode: 'default' },
  { platform: 'qoder', appDir: 'Qoder', extensionId: 'qoder.qoder', secretKey: 'qoder.auth', mode: 'qoder' },
  { platform: 'trae', appDir: 'Trae', extensionId: 'trae.trae', secretKey: 'trae.auth', mode: 'default' },
  { platform: 'codebuddy', appDir: 'CodeBuddy', extensionId: 'codebuddy.codebuddy', secretKey: 'codebuddy.auth', mode: 'codebuddy' },
  { platform: 'codebuddy_cn', appDir: 'CodeBuddy', extensionId: 'codebuddy.codebuddy', secretKey: 'codebuddy.auth', mode: 'codebuddy_cn' },
  { platform: 'antigravity', appDir: 'Antigravity', extensionId: 'antigravity.antigravity', secretKey: 'antigravity.auth', mode: 'default' },
]

export function buildCredentialRegistry(): ProviderRegistry {
  const registry = new ProviderRegistry()

  // --- OAuth (real implementations) ---
  registry.registerOAuth(new CursorOAuthCapability())
  registry.registerOAuth(new KiroOAuthCapability())
  registry.registerOAuth(new GitHubCopilotOAuthCapability())

  // --- Local import ---
  registry.registerLocalImport(new CursorLocalImportCapability())
  registry.registerLocalImport(new CodexLocalImportCapability())
  for (const config of VSCODE_SECRET_CONFIGS) {
    registry.registerLocalImport(new VsCodeSecretLocalImportCapability(config))
  }

  // --- File import (token JSON) + deep-link for every importable provider ---
  for (const platform of IMPORTABLE) {
    registry.registerFileImport(new TokenJsonFileImportCapability(platform))
    registry.registerDeepLink(new DeepLinkImportCapabilityImpl(platform))
  }

  return registry
}
