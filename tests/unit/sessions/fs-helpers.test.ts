import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtemp, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  mtimeMs,
  readHeadTailLines,
  assertPathWithinRoots,
} from '../../../src/main/contexts/sessions/infrastructure/fs-helpers'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'hxg-sessions-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('mtimeMs', () => {
  it('返回毫秒；不存在返回 0', async () => {
    const f = join(dir, 'a.txt')
    await writeFile(f, 'x')
    expect(await mtimeMs(f)).toBeGreaterThan(0)
    expect(await mtimeMs(join(dir, 'missing'))).toBe(0)
  })
})

describe('readHeadTailLines', () => {
  it('小文件：取头尾若干非空行', async () => {
    const f = join(dir, 'small.jsonl')
    await writeFile(f, ['l1', 'l2', '', 'l3', 'l4', 'l5'].join('\n'))
    const { head, tail } = await readHeadTailLines(f, 2, 2)
    expect(head).toEqual(['l1', 'l2'])
    expect(tail).toEqual(['l4', 'l5'])
  })
})

describe('assertPathWithinRoots', () => {
  it('在根内放行，根外抛错', async () => {
    const root = join(dir, 'root')
    await mkdir(root, { recursive: true })
    const inside = join(root, 'x.jsonl')
    await writeFile(inside, '{}')
    await expect(assertPathWithinRoots(inside, [root])).resolves.toBeUndefined()
    await expect(assertPathWithinRoots(join(dir, 'outside.jsonl'), [root])).rejects.toThrow(/越界|outside|not within/i)
  })
})
