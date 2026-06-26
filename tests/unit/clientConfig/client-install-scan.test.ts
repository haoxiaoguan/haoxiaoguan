import { describe, it, expect } from 'vitest'
import { firstAbsolutePathLine, isConflicting } from '../../../src/main/contexts/clientConfig/infrastructure/client-install-scan'
import type { ClientInstallation } from '../../../src/main/contexts/clientConfig/domain/client-version'

const inst = (p: Partial<ClientInstallation>): ClientInstallation => ({
  path: '/x/bin/claude',
  runnable: true,
  source: 'npm',
  isPathDefault: false,
  ...p,
})

describe('isConflicting（对称移植 cc-switch is_conflicting）', () => {
  it('单处安装 → 不冲突', () => {
    expect(isConflicting([inst({ version: '1.0.0' })])).toBe(false)
    expect(isConflicting([])).toBe(false)
  })

  it('多处但版本一致且都可运行 → 不冲突', () => {
    expect(
      isConflicting([
        inst({ path: '/a/claude', version: '1.0.0' }),
        inst({ path: '/b/claude', version: '1.0.0' }),
      ]),
    ).toBe(false)
  })

  it('多处版本分歧 → 冲突', () => {
    expect(
      isConflicting([
        inst({ path: '/a/claude', version: '1.0.0' }),
        inst({ path: '/b/claude', version: '2.0.0' }),
      ]),
    ).toBe(true)
  })

  it('多处运行态混合（一处能跑一处不能）→ 冲突', () => {
    expect(
      isConflicting([
        inst({ path: '/a/claude', version: '1.0.0', runnable: true }),
        inst({ path: '/b/claude', version: undefined, runnable: false }),
      ]),
    ).toBe(true)
  })
})

describe('firstAbsolutePathLine（登录 shell 输出去噪）', () => {
  it('跳过 .zshrc 欢迎语，取第一条绝对路径', () => {
    expect(firstAbsolutePathLine('Welcome back\n/Users/me/.bun/bin/claude\n')).toBe('/Users/me/.bun/bin/claude')
  })

  it('路径后还有提示文本时，不误取最后一行噪声', () => {
    expect(firstAbsolutePathLine('/Users/me/.local/bin/hermes\nshell ready\n')).toBe('/Users/me/.local/bin/hermes')
  })

  it('没有绝对路径时返回 undefined', () => {
    expect(firstAbsolutePathLine('welcome\nbye\n')).toBeUndefined()
  })
})
