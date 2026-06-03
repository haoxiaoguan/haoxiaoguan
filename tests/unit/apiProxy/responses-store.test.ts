import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { ResponsesStore } from '../../../src/main/contexts/apiProxy/infrastructure/responses-store/responses-store'

let dir: string
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), 'resp-store-')) })
afterEach(() => { rmSync(dir, { recursive: true, force: true }) })

function doc(id: string, prev?: string) {
  return { id, createdAt: 0, status: 'completed', model: 'm', output: [], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 }, storedInput: 'hi', storedAt: Math.floor(Date.now() / 1000), ...(prev ? { previousResponseId: prev } : {}) }
}

describe('ResponsesStore', () => {
  it('save/load 往返', () => {
    const s = new ResponsesStore({ dir })
    s.save(doc('resp_a'))
    expect(s.load('resp_a')?.id).toBe('resp_a')
  })
  it('未知 id → null', () => {
    expect(new ResponsesStore({ dir }).load('resp_nope')).toBeNull()
  })
  it('TTL 过期 → null', () => {
    const s = new ResponsesStore({ dir, ttlMs: 1000 })
    const d = doc('resp_old'); d.storedAt = Math.floor(Date.now() / 1000) - 10
    s.save(d)
    expect(s.load('resp_old')).toBeNull()
  })
  it('generateResponseId 形如 resp_ 前缀且唯一', () => {
    const s = new ResponsesStore({ dir })
    const a = s.generateResponseId(); const b = s.generateResponseId()
    expect(a.startsWith('resp_')).toBe(true)
    expect(a).not.toBe(b)
  })
  it('恶意 id 不穿越目录', () => {
    const s = new ResponsesStore({ dir })
    expect(s.load('../../etc/passwd')).toBeNull()
  })
})
