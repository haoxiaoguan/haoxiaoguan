// Responses 有状态持久化（JSON 文件落盘）。隔离 I/O + 时钟 + 随机。
import { randomBytes } from 'node:crypto'
import { mkdirSync, writeFileSync, readFileSync, renameSync, rmSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { appDataDir } from '../../../../platform/persistence/paths'
import type { ResponseOutputItem, ResponsesUsage } from '../inbound/responses/responses-types'

const DEFAULT_TTL_MS = 30 * 24 * 60 * 60 * 1000

export interface StoredResponseDoc {
  id: string
  createdAt: number
  status: string
  model: string
  output: ResponseOutputItem[]
  usage: ResponsesUsage
  previousResponseId?: string
  instructions?: string
  storedInput: unknown
  storedAt: number
}

function sanitizeId(id: string): string {
  let out = ''
  for (const ch of id) {
    const c = ch.codePointAt(0) ?? 0
    if ((c >= 0x61 && c <= 0x7a) || (c >= 0x41 && c <= 0x5a) || (c >= 0x30 && c <= 0x39) || ch === '_' || ch === '-') out += ch
  }
  return out.length > 0 ? out : 'invalid'
}

export class ResponsesStore {
  private readonly dir: string
  private readonly ttlMs: number
  constructor(opts: { dir?: string; ttlMs?: number } = {}) {
    this.dir = opts.dir ?? join(appDataDir(), 'responses')
    this.ttlMs = opts.ttlMs ?? DEFAULT_TTL_MS
  }
  generateResponseId(): string {
    return `resp_${randomBytes(12).toString('hex')}${(Math.floor(Date.now() / 1000) & 0xffffffff).toString(16).padStart(8, '0')}`
  }
  generateItemId(index: number): string {
    return `item_${randomBytes(8).toString('hex')}_${index}`
  }
  save(doc: StoredResponseDoc): void {
    mkdirSync(this.dir, { recursive: true })
    const path = join(this.dir, sanitizeId(doc.id) + '.json')
    const tmp = path + '.tmp'
    writeFileSync(tmp, JSON.stringify(doc), { mode: 0o600 })
    renameSync(tmp, path)
  }
  load(id: string): StoredResponseDoc | null {
    const safe = sanitizeId(id)
    const path = join(this.dir, safe + '.json')
    let data: string
    try { data = readFileSync(path, 'utf8') } catch { return null }
    let doc: StoredResponseDoc
    try { doc = JSON.parse(data) as StoredResponseDoc } catch { return null }
    if (doc.storedAt > 0 && Date.now() - doc.storedAt * 1000 > this.ttlMs) {
      try { rmSync(path, { force: true }) } catch { /* ignore */ }
      return null
    }
    return doc
  }
  purgeExpired(): void {
    let entries: string[]
    try { entries = readdirSync(this.dir) } catch { return }
    const cutoff = Date.now() - this.ttlMs
    for (const name of entries) {
      if (!name.endsWith('.json')) continue
      const full = join(this.dir, name)
      try { if (statSync(full).mtimeMs < cutoff) rmSync(full, { force: true }) } catch { /* ignore */ }
    }
  }
}
