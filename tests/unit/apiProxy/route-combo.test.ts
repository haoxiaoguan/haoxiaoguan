import { describe, it, expect } from 'vitest'
import {
  isValidComboName,
  enabledStepModels,
  type RouteCombo,
} from '../../../src/main/contexts/apiProxy/domain/route-combo'

describe('isValidComboName', () => {
  it('接受字母数字与 _.-', () => {
    expect(isValidComboName('my-combo')).toBe(true)
    expect(isValidComboName('a.b_c-1')).toBe(true)
    expect(isValidComboName('premium')).toBe(true)
  })
  it('拒绝空 / 含斜杠 / 含空格 / 非 ASCII', () => {
    expect(isValidComboName('')).toBe(false)
    expect(isValidComboName('kr/claude')).toBe(false) // 斜杠会被当别名前缀模型
    expect(isValidComboName('my combo')).toBe(false)
    expect(isValidComboName('中文名')).toBe(false)
  })
  it('拒绝超长（>64）', () => {
    expect(isValidComboName('a'.repeat(64))).toBe(true)
    expect(isValidComboName('a'.repeat(65))).toBe(false)
  })
})

describe('enabledStepModels', () => {
  const base: Omit<RouteCombo, 'steps'> = {
    id: 'c1', name: 'x', strategy: 'fallback', enabled: true,
  }
  it('保留启用步骤（enabled 缺省视为启用），剔除 enabled:false，保序', () => {
    const combo: RouteCombo = {
      ...base,
      steps: [
        { model: 'kr/claude-sonnet-4.5' },
        { model: 'relay-1/deepseek-chat', enabled: false },
        { model: 'cx/gpt-5', enabled: true },
      ],
    }
    expect(enabledStepModels(combo)).toEqual(['kr/claude-sonnet-4.5', 'cx/gpt-5'])
  })
  it('全部禁用 → 空数组', () => {
    const combo: RouteCombo = {
      ...base,
      steps: [{ model: 'a/b', enabled: false }],
    }
    expect(enabledStepModels(combo)).toEqual([])
  })
})
