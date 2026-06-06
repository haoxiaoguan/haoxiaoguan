import { describe, it, expect } from 'vitest'
import {
  parseManagedBlock,
  upsertManagedBlock,
  removeManagedBlock,
  ManagedBlockProtectedError,
  DEFAULT_MARKERS,
  type ManagedBlockMarkers,
} from '../../../src/main/contexts/clientConfig/domain/managed-block'

const M = DEFAULT_MARKERS
const B = M.begin
const E = M.end

describe('parseManagedBlock 三态', () => {
  it('无标记 → unmanaged', () => {
    expect(parseManagedBlock('').state).toBe('unmanaged')
    expect(parseManagedBlock('foo = 1\nbar = 2\n').state).toBe('unmanaged')
  })

  it('恰好一对、顺序正确 → ready，提取块内内容', () => {
    const content = `head\n${B}\nline1\nline2\n${E}\ntail`
    const p = parseManagedBlock(content)
    expect(p.state).toBe('ready')
    expect(p.block).toBe('line1\nline2')
  })

  it('重复 begin → protected', () => {
    const content = `${B}\nx\n${E}\n${B}\ny\n${E}`
    const p = parseManagedBlock(content)
    expect(p.state).toBe('protected')
    expect(p.reason).toContain('begin×2')
  })

  it('只有 begin（缺 end）→ protected', () => {
    expect(parseManagedBlock(`${B}\nx`).state).toBe('protected')
  })

  it('end 在 begin 之前 → protected', () => {
    expect(parseManagedBlock(`${E}\nx\n${B}`).state).toBe('protected')
  })
})

describe('upsertManagedBlock', () => {
  it('unmanaged → 末尾追加块，块外内容保留，再 parse 为 ready', () => {
    const out = upsertManagedBlock('foo = 1\nbar = 2\n', 'INJECTED')
    expect(out).toContain('foo = 1')
    expect(out).toContain('bar = 2')
    const p = parseManagedBlock(out)
    expect(p.state).toBe('ready')
    expect(p.block).toBe('INJECTED')
  })

  it('空文件 → 仅块', () => {
    const out = upsertManagedBlock('', 'X')
    expect(out).toBe(`${B}\nX\n${E}\n`)
  })

  it('ready → 原地替换块内内容，块外保留', () => {
    const content = `head\n${B}\nold\n${E}\ntail`
    const out = upsertManagedBlock(content, 'new1\nnew2')
    expect(parseManagedBlock(out).block).toBe('new1\nnew2')
    expect(out.startsWith('head\n')).toBe(true)
    expect(out.endsWith('\ntail')).toBe(true)
    expect(out).not.toContain('old')
  })

  it('幂等：同 body 重复 upsert 结果一致', () => {
    const once = upsertManagedBlock('foo = 1\n', 'BODY')
    const twice = upsertManagedBlock(once, 'BODY')
    expect(twice).toBe(once)
  })

  it('protected → 抛 ManagedBlockProtectedError，不写', () => {
    const corrupt = `${B}\nx\n${B}\ny\n${E}`
    expect(() => upsertManagedBlock(corrupt, 'Z')).toThrow(ManagedBlockProtectedError)
  })
})

describe('removeManagedBlock', () => {
  it('ready → 删块、保留块外、吞掉分隔空行', () => {
    const original = 'foo = 1\nbar = 2\n'
    const injected = upsertManagedBlock(original, 'BODY')
    const removed = removeManagedBlock(injected)
    expect(parseManagedBlock(removed).state).toBe('unmanaged')
    expect(removed).toContain('foo = 1')
    expect(removed).toContain('bar = 2')
    expect(removed).not.toContain('BODY')
    expect(removed).not.toContain(B)
  })

  it('unmanaged → 原样返回', () => {
    expect(removeManagedBlock('foo = 1\n')).toBe('foo = 1\n')
  })

  it('protected → 抛错，不动', () => {
    expect(() => removeManagedBlock(`${B}\n${B}\n${E}`)).toThrow(ManagedBlockProtectedError)
  })
})

describe('自定义标记（json5 用 // 前缀）', () => {
  const JS5: ManagedBlockMarkers = {
    begin: '// >>> HAOXIAOGUAN MANAGED BEGIN >>>',
    end: '// <<< HAOXIAOGUAN MANAGED END <<<',
  }
  it('支持注入/解析自定义标记', () => {
    const out = upsertManagedBlock('{ a: 1 }\n', 'b: 2', JS5)
    const p = parseManagedBlock(out, JS5)
    expect(p.state).toBe('ready')
    expect(p.block).toBe('b: 2')
    // 默认标记看不到这个块
    expect(parseManagedBlock(out).state).toBe('unmanaged')
  })
})
