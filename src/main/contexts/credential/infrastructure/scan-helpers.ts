import { homedir } from 'node:os'
import { join } from 'node:path'

// Shared helpers for credential capabilities — 对应 quota
// local/common.rs + oauth/common.rs portable utilities (JWT decode, path
// resolution, pick_string). No network, no electron import.

export interface JsonObject {
  [key: string]: unknown
}

/** Decode a JWT payload segment (base64url, padded or unpadded). No verification. */
export function jwtPayload(token: string): JsonObject | undefined {
  const seg = token.split('.')[1]
  if (!seg) return undefined
  try {
    const buf = Buffer.from(seg, 'base64url')
    const parsed = JSON.parse(buf.toString('utf8'))
    return typeof parsed === 'object' && parsed !== null ? (parsed as JsonObject) : undefined
  } catch {
    return undefined
  }
}

/** Extract a single string claim from a JWT. */
export function jwtClaimString(token: string, key: string): string | undefined {
  const payload = jwtPayload(token)
  const value = payload?.[key]
  return typeof value === 'string' ? value : undefined
}

/**
 * pick_string — walk a list of key paths against a root object, returning the
 * first string/number value found. Mirrors the Rust pick_string helper.
 */
export function pickString(root: unknown, paths: string[][]): string | undefined {
  if (root === null || root === undefined) return undefined
  for (const path of paths) {
    let current: unknown = root
    let ok = true
    for (const key of path) {
      if (current !== null && typeof current === 'object' && key in (current as JsonObject)) {
        current = (current as JsonObject)[key]
      } else {
        ok = false
        break
      }
    }
    if (!ok) continue
    if (typeof current === 'string') {
      const trimmed = current.trim()
      if (trimmed.length > 0) return trimmed
    } else if (typeof current === 'number') {
      return String(current)
    }
  }
  return undefined
}

/** Home directory (mirrors home_dir). */
export function homeDir(): string {
  return homedir()
}

/**
 * Cross-OS app data dir for ANOTHER app's config (对应 app_data_dir):
 *   macOS  ~/Library/Application Support/<name>
 *   Windows %APPDATA%/<name>
 *   Linux  $XDG_CONFIG_HOME/<name> or ~/.config/<name>
 */
export function appDataDir(name: string): string {
  const home = homedir()
  if (process.platform === 'darwin') return join(home, 'Library', 'Application Support', name)
  if (process.platform === 'win32') {
    return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), name)
  }
  return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), name)
}

/** state.vscdb path for a VSCode-family app dir. */
export function stateVscdbPath(appDir: string): string {
  return join(appDataDir(appDir), 'User', 'globalStorage', 'state.vscdb')
}

/** Parse an expires_at value (RFC3339 string OR unix seconds/millis number). */
export function parseExpiresAt(raw: unknown): Date | undefined {
  if (raw === null || raw === undefined) return undefined
  if (typeof raw === 'number') {
    const seconds = raw > 10_000_000_000 ? Math.floor(raw / 1000) : raw
    if (seconds <= 0) return undefined
    return new Date(seconds * 1000)
  }
  if (typeof raw === 'string') {
    const text = raw.trim()
    if (text.length === 0) return undefined
    const asNum = Number(text)
    if (!Number.isNaN(asNum) && /^\d+$/.test(text)) {
      const seconds = asNum > 10_000_000_000 ? Math.floor(asNum / 1000) : asNum
      return new Date(seconds * 1000)
    }
    const ms = Date.parse(text)
    return Number.isNaN(ms) ? undefined : new Date(ms)
  }
  return undefined
}
