// PlatformId — agent platform identity used by the account context.
//
// Three string projections matter and are NOT the same:
//   1. canonical DB form (agent_id column / switch_history.agent_id) — snake_case
//      (e.g. "github_copilot", "gemini_cli", "codebuddy_cn"). This is what the
//      aggregate stores and what serializes to the wire.
//   2. frontend id (AccountResponse.platform on the wire) — kebab for multi-word
//      ids (e.g. "github-copilot", "gemini-cli", "codebuddy-cn", "claude-desktop").
//   3. identity prefix used when synthesising an identity_key fallback — kebab,
//      defined only for the 12 importable platforms.
//
// parsePlatform() is case-insensitive, accepts hyphen/underscore/concatenated
// spellings, and ONLY the 12 importable platforms.

export type PlatformId =
  | 'cursor'
  | 'windsurf'
  | 'antigravity'
  | 'kiro'
  | 'github_copilot'
  | 'codebuddy'
  | 'codebuddy_cn'
  | 'qoder'
  | 'trae'
  | 'zed'
  | 'codex'
  | 'gemini_cli'
  | 'claude'
  | 'claude_desktop'
  | 'gemini'
  | 'opencode'
  | 'hermes'

// All 17 agent ids in canonical snake_case form.
export const ALL_PLATFORM_IDS: readonly PlatformId[] = [
  'cursor',
  'windsurf',
  'antigravity',
  'kiro',
  'github_copilot',
  'codebuddy',
  'codebuddy_cn',
  'qoder',
  'trae',
  'zed',
  'codex',
  'gemini_cli',
  'claude',
  'claude_desktop',
  'gemini',
  'opencode',
  'hermes',
]

// The 12 platforms account import/switch accepts.
const IMPORTABLE_PLATFORMS: readonly PlatformId[] = [
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
const IMPORTABLE_SET = new Set<string>(IMPORTABLE_PLATFORMS)

// Frontend id projection. Full 17-platform map.
const FRONTEND_ID: Record<PlatformId, string> = {
  cursor: 'cursor',
  windsurf: 'windsurf',
  antigravity: 'antigravity',
  kiro: 'kiro',
  github_copilot: 'github-copilot',
  codex: 'codex',
  gemini_cli: 'gemini-cli',
  codebuddy: 'codebuddy',
  codebuddy_cn: 'codebuddy-cn',
  qoder: 'qoder',
  trae: 'trae',
  zed: 'zed',
  claude: 'claude',
  claude_desktop: 'claude-desktop',
  gemini: 'gemini',
  opencode: 'opencode',
  hermes: 'hermes',
}

// Identity prefix (platform_profile::platform_identity_prefix) — kebab for the
// 12 importable platforms; "unknown" otherwise (matches source `_ => "unknown"`).
const IDENTITY_PREFIX: Partial<Record<PlatformId, string>> = {
  cursor: 'cursor',
  windsurf: 'windsurf',
  antigravity: 'antigravity',
  kiro: 'kiro',
  github_copilot: 'github-copilot',
  codex: 'codex',
  gemini_cli: 'gemini-cli',
  codebuddy: 'codebuddy',
  codebuddy_cn: 'codebuddy-cn',
  qoder: 'qoder',
  trae: 'trae',
  zed: 'zed',
}

/**
 * Parse a platform string into its canonical snake_case PlatformId
 * (case-insensitive; hyphen/underscore/concatenated variants). Throws
 * "Unknown platform: {input}" on miss.
 */
export function parsePlatform(input: string): PlatformId {
  switch (input.toLowerCase()) {
    case 'cursor':
      return 'cursor'
    case 'windsurf':
      return 'windsurf'
    case 'antigravity':
    case 'antigravity_ide':
    case 'antigravity-ide':
      return 'antigravity'
    case 'kiro':
      return 'kiro'
    case 'github_copilot':
    case 'github-copilot':
    case 'githubcopilot':
      return 'github_copilot'
    case 'codex':
      return 'codex'
    case 'gemini_cli':
    case 'gemini-cli':
    case 'geminicli':
      return 'gemini_cli'
    case 'codebuddy':
      return 'codebuddy'
    case 'codebuddy_cn':
    case 'codebuddy-cn':
    case 'codebuddycn':
      return 'codebuddy_cn'
    case 'qoder':
      return 'qoder'
    case 'trae':
      return 'trae'
    case 'zed':
      return 'zed'
    default:
      throw new Error(`Unknown platform: ${input}`)
  }
}

/**
 * Parse the platform string used by import_from_json: same set — throws
 * `Unknown platform: {input}` so the import loop can record the error.
 */
export function parsePlatformLoose(input: string): PlatformId {
  return parsePlatform(input)
}

/** Canonical DB/agent_id string for a platform (snake_case). */
export function platformToAgentId(platform: PlatformId): string {
  return platform
}

/** Frontend wire id (kebab for multi-word ids). */
export function platformToFrontendId(platform: PlatformId): string {
  return FRONTEND_ID[platform] ?? platform
}

/** Identity-key fallback prefix; "unknown" for non-importable platforms. */
export function platformIdentityPrefix(platform: PlatformId): string {
  return IDENTITY_PREFIX[platform] ?? 'unknown'
}

/** True if the agent_id string is one of the 12 importable platforms. */
export function isImportablePlatform(agentId: string): boolean {
  return IMPORTABLE_SET.has(agentId)
}

/**
 * Reconstruct a PlatformId from a stored agent_id string (DB read path).
 * Falls back to 'cursor' on an unknown value.
 */
export function platformFromAgentIdOrCursor(agentId: string): PlatformId {
  return (ALL_PLATFORM_IDS as readonly string[]).includes(agentId)
    ? (agentId as PlatformId)
    : 'cursor'
}
