// Minimal Electron stub for vitest (plain-Node) runs. Main-process modules now
// import { safeStorage, app } from 'electron' statically (required because the
// bytecode .cjsc bundle has no dynamic-import callback). Under vitest there is no
// Electron runtime, so this stub stands in. safeStorage reports encryption
// unavailable, which drives the degraded raw-utf8 fallback paths that the unit
// tests already exercise.
export const safeStorage = {
  isEncryptionAvailable(): boolean {
    return false
  },
  encryptString(plain: string): Buffer {
    return Buffer.from(plain, 'utf8')
  },
  decryptString(buf: Buffer): string {
    return buf.toString('utf8')
  },
}

export const app = {
  getPath(_name: string): string {
    return process.cwd()
  },
  getVersion(): string {
    return '0.0.0-test'
  },
  setLoginItemSettings(_settings: unknown): void {},
  setPath(_name: string, _path: string): void {},
}

export const ipcMain = {
  handle(_channel: string, _listener: unknown): void {},
}

export default { safeStorage, app, ipcMain }
