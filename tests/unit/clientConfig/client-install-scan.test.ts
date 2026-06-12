import { describe, it, expect } from 'vitest'
import { isConflicting } from '../../../src/main/contexts/clientConfig/infrastructure/client-install-scan'
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
