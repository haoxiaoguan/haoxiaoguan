import { homedir } from 'node:os'
import { join } from 'node:path'

// 对应 path_resolver: macOS ~/Library/Application Support/<name>,
// Linux ~/.config/<name>, Windows %APPDATA%\<name>. These target OTHER apps'
// config dirs (Cursor, Kiro, ...), so they must match the source exactly.
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
export function appDataDir(): string {
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
