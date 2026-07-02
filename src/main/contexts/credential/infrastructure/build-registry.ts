import { type PlatformId } from '../../account/domain/platform-id'
import type { CryptoService } from '../../../platform/crypto/crypto-service'
import { ProviderRegistry } from '../domain/provider-registry'
import { CursorLocalImportCapability } from './capabilities/cursor-local-import'
import { CodexLocalImportCapability } from './capabilities/codex-local-import'
import { KiroLocalImportCapability } from './capabilities/kiro-local-import'
import { TraeLocalImportCapability } from './capabilities/trae-local-import'
import { GitHubCopilotLocalImportCapability } from './capabilities/github-copilot-local-import'
import { GeminiLocalImportCapability } from './capabilities/gemini-local-import'
import { ZedLocalImportCapability } from './capabilities/zed-local-import'
import { QoderLocalImportCapability } from './capabilities/qoder-local-import'
import { CodebuddyLocalImportCapability } from './capabilities/codebuddy-local-import'
import { WindsurfLocalImportCapability } from './capabilities/windsurf-local-import'
import { AntigravityLocalImportCapability } from './capabilities/antigravity-local-import'
import { TokenExpiryValidationCapability } from './capabilities/token-expiry-validation'
import { CursorOAuthCapability } from './capabilities/cursor-oauth'
import { KiroOAuthCapability } from './capabilities/kiro-oauth'
import { GitHubCopilotOAuthCapability } from './capabilities/github-copilot-oauth'
import { CodexOAuthCapability } from './capabilities/codex-oauth'
import { AntigravityOAuthCapability } from './capabilities/antigravity-oauth'
import { GeminiOAuthCapability } from './capabilities/gemini-oauth'
import { CodebuddyOAuthCapability } from './capabilities/codebuddy-oauth'
import { ZedOAuthCapability } from './capabilities/zed-oauth'
import { QoderOAuthCapability } from './capabilities/qoder-oauth'
import { WindsurfOAuthCapability } from './capabilities/windsurf-oauth'
import { TraeOAuthCapability } from './capabilities/trae-oauth'
import { TokenJsonFileImportCapability } from './capabilities/token-json-file-import'
import { KiroTokenJsonImportCapability } from './capabilities/kiro-token-json-import'
import { DeepLinkImportCapabilityImpl } from './capabilities/deep-link-import'

// build-registry — assembles the credential ProviderRegistry: register the real
// capabilities, leaving providers without an implementation to surface a typed
// UnsupportedSource error from the services (an absent map entry is the
// equivalent of a stub and avoids dead stub objects).
//
// Implemented for real:
//   - OAuth:        cursor (poll), kiro (loopback), github_copilot (device flow),
//                   codex (loopback PKCE, auth.openai.com), antigravity + gemini_cli
//                   (Google auth-code loopback), codebuddy(_cn) (server-side poll),
//                   zed (loopback + RSA), qoder (device poll + PKCE),
//                   windsurf (Firebase implicit + RegisterUser),
//                   trae (loopback + PKCE + ECDSA device key)
//   - LocalScan:    all 12 importable providers have a dedicated scanner:
//                   cursor (state.vscdb), codex (auth.json), kiro (AWS SSO
//                   token file + profile.json + state.vscdb usage), trae
//                   (storage.json ByteCrypto), github_copilot (encrypted
//                   github.auth sessions), gemini_cli (~/.gemini + keychain),
//                   zed (macOS keychain), qoder (3 bare-key secrets),
//                   codebuddy(_cn) (encrypted session, multi-candidate keys),
//                   windsurf (plain windsurfAuthStatus), antigravity (protobuf
//                   antigravityUnifiedStateSync.oauthToken/userStatus)
//   - TokenJson:    all 12 importable providers (generic normaliser)
//   - DeepLink:     all 12 importable providers (haoxiaoguan://import/... parser)
//
// All 12 importable platforms now have a real OAuth capability. Endpoints/client
// ids/signing were obtained from the reference desktop clients; the produced
// rawMetadata matches each platform's local-scan/token-json shape so profile
// derivation, credential injection and quota refresh keep working unchanged.

// The 12 importable platforms.
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

// NOTE: the generic VsCodeSecretLocalImportCapability (one secret:// key →
// {token} JSON) is no longer registered for any platform — every VSCode-family
// provider's real storage differs (bare keys, session arrays, plain keys,
// protobuf, ByteCrypto), so each uses a dedicated scanner below.

export function buildCredentialRegistry(
  crypto?: CryptoService,
  // Live resolver for the per-platform require_online_check_kiro setting (read at
  // scan/import time): true → confirm Kiro identity online (abort on failure),
  // false (default) → skip the online check and import with a placeholder.
  requireOnlineKiroIdentity?: () => boolean,
): ProviderRegistry {
  const registry = new ProviderRegistry()

  // --- OAuth (real implementations) ---
  registry.registerOAuth(new CursorOAuthCapability())
  registry.registerOAuth(new KiroOAuthCapability())
  registry.registerOAuth(new GitHubCopilotOAuthCapability())
  registry.registerOAuth(new CodexOAuthCapability())
  registry.registerOAuth(new AntigravityOAuthCapability('antigravity'))
  registry.registerOAuth(new AntigravityOAuthCapability('antigravity_ide'))
  registry.registerOAuth(new GeminiOAuthCapability())
  registry.registerOAuth(new CodebuddyOAuthCapability('codebuddy'))
  registry.registerOAuth(new CodebuddyOAuthCapability('codebuddy_cn'))
  registry.registerOAuth(new ZedOAuthCapability())
  registry.registerOAuth(new QoderOAuthCapability())
  registry.registerOAuth(new WindsurfOAuthCapability())
  registry.registerOAuth(new TraeOAuthCapability())

  // --- Credential validation. Network-free expiry/refresh-token check, applied
  //     to every importable platform so the top-right status badge shows a real
  //     state (正常 / 已过期) instead of 未支持. Requires the CryptoService to
  //     decrypt the stored envelope. ---
  if (crypto) {
    for (const platform of IMPORTABLE) {
      registry.registerValidation(new TokenExpiryValidationCapability(platform, crypto))
    }
  }

  // --- Local import ---
  registry.registerLocalImport(new CursorLocalImportCapability())
  registry.registerLocalImport(new CodexLocalImportCapability())
  registry.registerLocalImport(new KiroLocalImportCapability(undefined, undefined, undefined, requireOnlineKiroIdentity ?? false))
  // Bespoke local scanners (client login not in a generic state.vscdb {token} secret):
  //   trae            → storage.json iCubeAuthInfo://*（ByteCrypto v1）
  //   github_copilot  → state.vscdb 加密 github.auth sessions 数组
  //   gemini_cli      → ~/.gemini 多文件 + macOS Keychain 兜底
  //   zed             → macOS Keychain internet-password（https://zed.dev）
  //   qoder           → state.vscdb 三个裸 key 加密 secret（userInfo/userPlan/creditUsage）
  //   codebuddy(_cn)  → state.vscdb 加密 session（extensionId/key 按发行版多候选）
  //   windsurf        → state.vscdb 明文 windsurfAuthStatus + windsurf_auth-* 登录提示
  //   antigravity(_ide) → state.vscdb 明文 antigravityUnifiedStateSync.oauthToken/userStatus
  //                    （protobuf；antigravity→"Antigravity"、antigravity_ide→"Antigravity IDE"）
  registry.registerLocalImport(new TraeLocalImportCapability())
  registry.registerLocalImport(new GitHubCopilotLocalImportCapability())
  registry.registerLocalImport(new GeminiLocalImportCapability())
  registry.registerLocalImport(new ZedLocalImportCapability())
  registry.registerLocalImport(new QoderLocalImportCapability())
  registry.registerLocalImport(new CodebuddyLocalImportCapability('codebuddy'))
  registry.registerLocalImport(new CodebuddyLocalImportCapability('codebuddy_cn'))
  registry.registerLocalImport(new WindsurfLocalImportCapability())
  registry.registerLocalImport(new AntigravityLocalImportCapability('antigravity'))
  registry.registerLocalImport(new AntigravityLocalImportCapability('antigravity_ide'))

  // --- File import (token JSON) + deep-link for every importable provider ---
  for (const platform of IMPORTABLE) {
    registry.registerFileImport(new TokenJsonFileImportCapability(platform))
    registry.registerDeepLink(new DeepLinkImportCapabilityImpl(platform))
  }

  // Kiro overrides the generic token-JSON parser: pasted enterprise (IdC) tokens
  // carry no real identity in the blob, so it runs the same identity enrichment
  // (default: skip online + placeholder; require_online_check_kiro on: confirm
  // online). Registered AFTER the loop so it replaces the generic entry for
  // 'kiro' (the registry maps by provider id).
  registry.registerFileImport(new KiroTokenJsonImportCapability(requireOnlineKiroIdentity ?? false))

  return registry
}
