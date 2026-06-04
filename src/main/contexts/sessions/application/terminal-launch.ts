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

/** 启动终端：detached + unref，不阻塞主进程，子进程独立存活。spawn 失败抛错。 */
export function launchTerminal(template: string, command: string, cwd: string | undefined): void {
  if (template.trim().length === 0) throw new Error('未配置终端启动模板')
  const { file, args } = buildLaunchInvocation(process.platform, template, command, cwd)
  const child = spawn(file, args, { detached: true, stdio: 'ignore' })
  child.on('error', () => {
    /* 由调用方在 spawn 同步阶段无法捕获的异步错误；这里吞掉，避免 unhandled */
  })
  child.unref()
}
