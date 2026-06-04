import { spawn } from 'node:child_process'

/** 把模板里的 {command}/{cwd} 占位符替换为实际值（cwd 缺省 '.'）。 */
export function resolveTemplate(template: string, command: string, cwd: string | undefined): string {
  const dir = cwd && cwd.trim().length > 0 ? cwd : '.'
  return template.split('{command}').join(command).split('{cwd}').join(dir)
}

export interface LaunchInvocation {
  file: string
  args: string[]
}

/** 按平台决定用哪个 shell 执行已替换的模板字符串。 */
export function buildLaunchInvocation(
  platform: NodeJS.Platform,
  template: string,
  command: string,
  cwd: string | undefined,
): LaunchInvocation {
  const resolved = resolveTemplate(template, command, cwd)
  if (platform === 'win32') return { file: 'cmd.exe', args: ['/c', resolved] }
  return { file: '/bin/sh', args: ['-c', resolved] }
}

/**
 * 启动参数（cwd/command）含 shell 注入危险字符时视为不安全。
 * 终端模板是用户自由配置的，无法可靠地按上下文转义，故含危险字符即拒绝在终端启动，
 * 由调用方降级为「复制命令」（剪贴板只是文本，安全）。
 */
const UNSAFE_LAUNCH_CHARS = /["'`$;&|<>\\\n\r]/
export function isLaunchArgSafe(value: string): boolean {
  return !UNSAFE_LAUNCH_CHARS.test(value)
}

/** 启动终端：detached + unref，不阻塞主进程，子进程独立存活。spawn 失败抛错。 */
export function launchTerminal(template: string, command: string, cwd: string | undefined): void {
  if (template.trim().length === 0) throw new Error('未配置终端启动模板')
  const dir = cwd && cwd.trim().length > 0 ? cwd : '.'
  if (!isLaunchArgSafe(dir) || !isLaunchArgSafe(command)) {
    throw new Error('工作目录或命令含不安全字符，已拒绝在终端启动（请改用复制命令）')
  }
  const { file, args } = buildLaunchInvocation(process.platform, template, command, cwd)
  const child = spawn(file, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {
    /* 异步 spawn 错误（如可执行文件不存在）在此吞掉，避免 unhandled */
  })
  child.unref()
}
