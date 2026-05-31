// VSCode-family user-data / state.vscdb path resolution — mirrors Rust
// primitives::credential_io::vscode_paths. Provided for completeness; the
// VSCode-family adapters resolve storage.json via path-resolver.appSupportDir,
// but this captures the canonical per-OS layout and the state.vscdb relative
// path the source defines.

import { homedir } from 'node:os'
import { join } from 'node:path'

export interface VsCodeAppLayout {
  appDirMacos: string
  appDirWindows: string
  appDirLinux: string
}

export const STATE_VSCDB_RELATIVE = 'User/globalStorage/state.vscdb'

export function userDataDir(layout: VsCodeAppLayout): string {
  const home = homedir()
  switch (process.platform) {
    case 'darwin':
      return join(home, 'Library', 'Application Support', layout.appDirMacos)
    case 'win32':
      return join(process.env.APPDATA ?? join(home, 'AppData', 'Roaming'), layout.appDirWindows)
    default:
      return join(process.env.XDG_CONFIG_HOME ?? join(home, '.config'), layout.appDirLinux)
  }
}

export function stateVscdb(layout: VsCodeAppLayout): string {
  return join(userDataDir(layout), STATE_VSCDB_RELATIVE)
}
