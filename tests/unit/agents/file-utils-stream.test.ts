import { describe, it, expect, afterEach } from 'vitest'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { readJsonLinesAsync, readJsonLinesIter } from '../../../src/main/agents/shared/file-utils'

const dirs: string[] = []
afterEach(() => {
  for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true })
})

function tmpFile(content: string): string {
  const dir = mkdtempSync(join(tmpdir(), 'hxg-flines-'))
  dirs.push(dir)
  const p = join(dir, 'f.jsonl')
  writeFileSync(p, content, 'utf8')
  return p
}

async function collect(p: string): Promise<Array<[number, string]>> {
  const out: Array<[number, string]> = []
  for await (const pair of readJsonLinesIter(p)) out.push(pair)
  return out
}

describe('readJsonLinesIter（流式逐行）', () => {
  it('与 readJsonLinesAsync 输出完全一致（含空行索引、无尾换行）', async () => {
    const samples = [
      '{"a":1}\n{"b":2}\n{"c":3}\n', // 正常 + 尾换行
      '{"a":1}\n{"b":2}', // 无尾换行
      '{"a":1}\n\n{"b":2}\n', // 中间空行（索引应保留位置）
      '\n\n{"a":1}\n', // 前导空行
      '   \n{"a":1}\n', // 空白行（trim 后为空 → 跳过）
      '', // 空文件
    ]
    for (const s of samples) {
      const p = tmpFile(s)
      const expected = await readJsonLinesAsync(p)
      const actual = await collect(p)
      expect(actual).toEqual(expected)
    }
  })

  it('大量行不丢、索引单调递增', async () => {
    const N = 20000
    const lines = Array.from({ length: N }, (_, i) => `{"i":${i}}`).join('\n') + '\n'
    const p = tmpFile(lines)
    const actual = await collect(p)
    expect(actual).toHaveLength(N)
    expect(actual[0]).toEqual([0, '{"i":0}'])
    expect(actual[N - 1]).toEqual([N - 1, `{"i":${N - 1}}`])
  })
})
