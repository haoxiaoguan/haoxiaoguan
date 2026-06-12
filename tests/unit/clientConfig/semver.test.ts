import { describe, it, expect } from 'vitest'
import { parseSemver, compareSemver } from '../../../src/main/contexts/clientConfig/domain/semver'

describe('parseSemver', () => {
  it('解析三段 core + 预发布段', () => {
    expect(parseSemver('2.1.156')).toEqual({ core: [2, 1, 156], pre: [] })
    expect(parseSemver('2.1.156-beta.1')).toEqual({ core: [2, 1, 156], pre: ['beta', '1'] })
    expect(parseSemver('1.0.0+build.5')).toEqual({ core: [1, 0, 0], pre: [] }) // +build 元数据忽略
  })

  it('容纳 codex 时间戳式 patch（在 Number 安全范围内）', () => {
    expect(parseSemver('0.1.2505172116')).toEqual({ core: [0, 1, 2505172116], pre: [] })
  })

  it('非法/非三段 → null', () => {
    expect(parseSemver('2.1')).toBeNull()
    expect(parseSemver('2.1.3.4')).toBeNull()
    expect(parseSemver('v2.1.3')).toBeNull() // 前缀 v 不在此解析（提取在 extractVersion 阶段）
    expect(parseSemver('abc')).toBeNull()
  })
})

describe('compareSemver', () => {
  it('主版本三段优先', () => {
    expect(compareSemver('1.2.3', '1.2.4')).toBe(-1)
    expect(compareSemver('1.3.0', '1.2.9')).toBe(1)
    expect(compareSemver('2.0.0', '1.9.9')).toBe(1)
    expect(compareSemver('1.2.3', '1.2.3')).toBe(0)
  })

  it('core 相等：有预发布 < 无预发布', () => {
    expect(compareSemver('1.2.3-beta', '1.2.3')).toBe(-1)
    expect(compareSemver('1.2.3', '1.2.3-beta')).toBe(1)
  })

  it('预发布段逐段比（数字按数值、数字 < 非数字、段更多者更大）', () => {
    expect(compareSemver('1.2.3-beta.1', '1.2.3-beta.2')).toBe(-1)
    expect(compareSemver('1.2.3-beta.2', '1.2.3-beta.10')).toBe(-1) // 数值非字典序
    expect(compareSemver('1.2.3-alpha', '1.2.3-beta')).toBe(-1) // ASCII
    expect(compareSemver('1.2.3-1', '1.2.3-alpha')).toBe(-1) // 数字段 < 非数字段
    expect(compareSemver('1.2.3-beta', '1.2.3-beta.1')).toBe(-1) // 前缀相同段更多者更大
  })

  it('任一无法解析 → null（调用方保守处理）', () => {
    expect(compareSemver('1.2.3', 'nope')).toBeNull()
    expect(compareSemver('1.2', '1.2.3')).toBeNull()
  })

  it('upgradable 判定：installed < latest 才升级', () => {
    expect(compareSemver('1.0.86', '1.0.90') === -1).toBe(true) // 可升级
    expect(compareSemver('1.0.90', '1.0.90') === -1).toBe(false) // 已是最新
    expect(compareSemver('1.0.91', '1.0.90') === -1).toBe(false) // 本地领先（预发布通道）
  })
})
