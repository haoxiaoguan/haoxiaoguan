import { describe, it, expect } from 'vitest'
import { countLines, claudeEditChurn, patchChurn } from '../../../src/main/contexts/sessions/domain/code-edit-utils'

describe('code-edit-utils', () => {
  it('countLines', () => {
    expect(countLines(undefined)).toBe(0)
    expect(countLines('')).toBe(0)
    expect(countLines('a')).toBe(1)
    expect(countLines('a\nb\nc')).toBe(3)
  })
  it('Write churn = content 行数', () => {
    expect(claudeEditChurn('Write', { file_path: 'f', content: 'a\nb\nc' })).toBe(3)
  })
  it('Edit churn = old + new 行数', () => {
    expect(claudeEditChurn('Edit', { old_string: 'a\nb', new_string: 'x' })).toBe(3)
  })
  it('MultiEdit churn = 各 edit 累加', () => {
    expect(claudeEditChurn('MultiEdit', { edits: [{ old_string: 'a', new_string: 'b\nc' }, { old_string: 'd', new_string: 'e' }] })).toBe(5)
  })
  it('NotebookEdit churn = new_source 行数', () => {
    expect(claudeEditChurn('NotebookEdit', { new_source: 'a\nb' })).toBe(2)
  })
  it('非编辑工具 churn=0', () => {
    expect(claudeEditChurn('Bash', { command: 'ls' })).toBe(0)
  })
  it('patchChurn 数 +/-（跳过 *** 头、+++/---、@@）', () => {
    const patch = ['*** Begin Patch', '*** Update File: a.ts', '@@ ctx', ' keep', '-old', '+new1', '+new2', '*** End Patch'].join('\n')
    expect(patchChurn(patch)).toBe(3)
  })
})
