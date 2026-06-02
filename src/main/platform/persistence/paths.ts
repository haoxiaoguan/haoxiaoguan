import { homedir } from 'node:os'
import { join } from 'node:path'

// macOS ~/Library/Application Support/<name>,
// Linux ~/.config/<name>, Windows %APPDATA%\<name>. These target OTHER apps'
// config dirs (Cursor, Kiro, ...), so they must match those apps' conventions exactly.
export function appSupportDir(name: string): string {
  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', name)
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), name)
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), name)
  }
}

export function dotDir(name: string): string {
  return join(homedir(), `.${name}`)
}

// haoxiaoguan's own data dir. NOTE: source used bundle id com.haoxiaoguan.app on
// macOS. Since we do not preserve old data, we use a stable "haoxiaoguan" dir on
// all platforms; main.ts also sets app.setPath('userData', appDataDir()).
//
// HXG_USER_DATA_DIR overrides the location so e2e tests isolate each launch (the
// DB, master key, and encrypted credentials must all live in the SAME dir across
// launches, or decrypt fails with an auth-tag error). We deliberately do NOT
// derive this from Electron's app.getPath('userData'): main.ts evaluates
// appDataDir() to FEED that setPath call, so reading it back here would be a
// chicken-and-egg hazard (and could relocate production data to Electron's
// default app dir under dev). A single stable per-OS default keeps every
// consumer — DB config, crypto, settings — pointed at one place.
export function appDataDir(): string {
  const override = process.env.HXG_USER_DATA_DIR
  if (override) return override

  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', 'haoxiaoguan')
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), 'haoxiaoguan')
    default:
      return join(process.env.XDG_DATA_HOME ?? join(home, '.local', 'share'), 'haoxiaoguan')
  }
}

export function appConfigDir(): string {
  return join(appDataDir(), 'config')
}

export function appLogDir(): string {
  if (process.platform === 'darwin') return join(homedir(), 'Library', 'Logs', 'haoxiaoguan')
  return join(appDataDir(), 'logs')
}
