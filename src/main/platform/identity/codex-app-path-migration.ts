// Codex→ChatGPT 改名：已保存官方旧启动路径的守卫式一次性自愈（对照 cockpit v1.3.8）。
// 只有「保存的是官方旧路径」且「探测到官方 ChatGPT 新路径」才改写；自定义路径永不动。
// 功能正确性不依赖本迁移（mac 有 bundle id 兜底、win launch 自带探测回退），
// 这里只做设置项卫生，故任何异常吞掉只记日志。
import { detectAppPath, type AppPathInfo } from './app-paths'

/** mac 官方旧路径：/Applications/Codex.app（或其主执行文件），容忍尾斜杠/大小写。 */
export function isLegacyOfficialCodexMacPath(p: string): boolean {
  const normalized = p.trim().replace(/\/+$/, '').toLowerCase()
  return (
    normalized === '/applications/codex.app' ||
    normalized === '/applications/codex.app/contents/macos/codex'
  )
}

/** win 官方旧路径：WindowsApps 下 OpenAI.Codex 包内的 codex.exe。 */
export function isLegacyOfficialCodexWinPath(p: string): boolean {
  const normalized = p.trim().toLowerCase()
  return normalized.endsWith('\\codex.exe') && normalized.includes('\\windowsapps\\openai.codex_')
}

/** 探测结果是否为官方 ChatGPT 新路径（迁移目标）。 */
export function isOfficialChatGptDetectedPath(detected: string, platform: NodeJS.Platform): boolean {
  if (platform === 'darwin') return detected === '/Applications/ChatGPT.app'
  if (platform === 'win32') return detected.toLowerCase().endsWith('\\chatgpt.exe')
  return false
}

export interface CodexIdePathMigrationDeps {
  /** 读取已保存的 idePaths.codex。 */
  getSavedPath: () => string | undefined
  /** 持久化新路径（等价 updateSettings({ ide_path_codex })）。 */
  savePath: (path: string) => Promise<void>
  /** 探测函数（默认 detectAppPath('codex')；可注入已算好的结果避免重复探测）。 */
  detect?: () => Promise<AppPathInfo>
  /** 平台（默认 process.platform，注入便于单测）。 */
  platform?: NodeJS.Platform
}

/** 守卫式迁移；返回是否发生迁移。先查守卫后跑探测，普通用户零开销；绝不上抛。 */
export async function migrateLegacyCodexIdePathIfNeeded(
  deps: CodexIdePathMigrationDeps,
): Promise<boolean> {
  try {
    const platform = deps.platform ?? process.platform
    if (platform !== 'darwin' && platform !== 'win32') return false
    const saved = deps.getSavedPath()?.trim()
    if (saved === undefined || saved.length === 0) return false
    const isLegacy =
      platform === 'darwin' ? isLegacyOfficialCodexMacPath(saved) : isLegacyOfficialCodexWinPath(saved)
    if (!isLegacy) return false
    const detect = deps.detect ?? (() => detectAppPath('codex'))
    const info = await detect()
    if (info.detected === null) return false
    if (!isOfficialChatGptDetectedPath(info.detected, platform)) return false
    if (info.detected === saved) return false
    // 写前复检：探测是异步的(win PowerShell 回退可达数秒)，窗口期内用户可能已在设置里
    // 保存了自定义路径；只有保存值仍是进入时捕获的官方旧路径才落笔，守住「自定义路径永不动」。
    if (deps.getSavedPath()?.trim() !== saved) return false
    await deps.savePath(info.detected)
    return true
  } catch (e) {
    console.warn('[codex] ChatGPT 启动路径迁移失败(忽略，不影响主流程):', e)
    return false
  }
}
