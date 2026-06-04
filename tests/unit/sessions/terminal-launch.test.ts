import { describe, it, expect } from 'vitest'
import { resolveTemplate, buildLaunchInvocation, isLaunchArgSafe } from '../../../src/main/contexts/sessions/application/terminal-launch'

describe('resolveTemplate', () => {
  it('替换 {command} 与 {cwd}', () => {
    expect(resolveTemplate('wt -d "{cwd}" cmd /k "{command}"', 'claude --resume x', '/a b')).toBe(
      'wt -d "/a b" cmd /k "claude --resume x"',
    )
  })
  it('cwd 缺省为 .', () => {
    expect(resolveTemplate('echo {cwd}', 'c', undefined)).toBe('echo .')
  })
})

describe('buildLaunchInvocation', () => {
  it('win32 用 cmd /c', () => {
    expect(buildLaunchInvocation('win32', 'wt -d "{cwd}" cmd /k "{command}"', 'c', '/w')).toEqual({
      file: 'cmd.exe',
      args: ['/c', 'wt -d "/w" cmd /k "c"'],
    })
  })
  it('非 win32 用 sh -c', () => {
    expect(buildLaunchInvocation('darwin', 'sh: {command}', 'c', '/w')).toEqual({
      file: '/bin/sh',
      args: ['-c', 'sh: c'],
    })
  })
})

describe('isLaunchArgSafe', () => {
  it('普通路径/命令安全', () => {
    expect(isLaunchArgSafe('/Users/me/my proj')).toBe(true)
    expect(isLaunchArgSafe('claude --resume abc-123')).toBe(true)
  })
  it('含 shell 危险字符不安全', () => {
    expect(isLaunchArgSafe('/tmp/evil" && rm -rf ~')).toBe(false)
    expect(isLaunchArgSafe('/x; reboot')).toBe(false)
    expect(isLaunchArgSafe('/x`whoami`')).toBe(false)
    expect(isLaunchArgSafe('/x$(id)')).toBe(false)
    expect(isLaunchArgSafe('/x | tee')).toBe(false)
  })
})
