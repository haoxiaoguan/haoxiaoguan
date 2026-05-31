// Path resolver for agent config dirs — mirrors Rust
// agents::infrastructure::shared::path_resolver. Thin wrappers over the shared
// platform paths (which already implement the per-OS branches the source uses:
// macOS ~/Library/Application Support/<name>, Linux ~/.config/<name>,
// Windows %APPDATA%/<name>). Re-exported here so adapters import from one place,
// matching the source module layout.

import { homedir } from 'node:os'
import { appSupportDir as platformAppSupportDir, dotDir as platformDotDir } from '../../../platform/persistence/paths'

export function homeDir(): string {
  return homedir()
}

/** Other apps' config dir: macOS/Library/Application Support, Linux ~/.config, Win %APPDATA%. */
export function appSupportDir(name: string): string {
  return platformAppSupportDir(name)
}

/** ~/.<name> */
export function dotDir(name: string): string {
  return platformDotDir(name)
}
