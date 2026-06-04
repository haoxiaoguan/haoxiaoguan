import { createReadStream } from 'node:fs'
import { open, stat, realpath } from 'node:fs/promises'
import { createInterface } from 'node:readline'
import { resolve, sep } from 'node:path'

const SMALL_FILE_THRESHOLD = 16384 // 16KB：小文件整读，大文件头尾读
const TAIL_WINDOW = 16384

/** 文件 mtime（epoch 毫秒）；不存在/出错返回 0（probe/排序用，不抛）。 */
export async function mtimeMs(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs
  } catch {
    return 0
  }
}

export interface HeadTail {
  head: string[]
  tail: string[]
}

/** 只读文件头 headN 行 + 尾 tailN 行（非空 trim 行）。大文件不整读，避免大 jsonl 卡顿。 */
export async function readHeadTailLines(path: string, headN: number, tailN: number): Promise<HeadTail> {
  const size = (await stat(path)).size
  if (size < SMALL_FILE_THRESHOLD) {
    const fh = await open(path, 'r')
    try {
      const text = (await fh.readFile()).toString('utf8')
      const lines = text.split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
      return { head: lines.slice(0, headN), tail: lines.slice(Math.max(0, lines.length - tailN)) }
    } finally {
      await fh.close()
    }
  }
  return { head: await readHead(path, headN), tail: await readTail(path, size, tailN) }
}

async function readHead(path: string, headN: number): Promise<string[]> {
  const stream = createReadStream(path, { encoding: 'utf8' })
  const rl = createInterface({ input: stream, crlfDelay: Infinity })
  const lines: string[] = []
  try {
    for await (const line of rl) {
      const t = line.trim()
      if (t.length > 0) {
        lines.push(t)
        if (lines.length >= headN) break
      }
    }
  } finally {
    rl.close()
    stream.destroy()
  }
  return lines
}

async function readTail(path: string, size: number, tailN: number): Promise<string[]> {
  const seekPos = Math.max(0, size - TAIL_WINDOW)
  const fh = await open(path, 'r')
  try {
    const buf = Buffer.alloc(size - seekPos)
    const { bytesRead } = await fh.read(buf, 0, buf.length, seekPos)
    let lines = buf.toString('utf8', 0, bytesRead).split('\n').map((l) => l.trim()).filter((l) => l.length > 0)
    if (seekPos > 0 && lines.length > 0) lines = lines.slice(1) // 丢弃可能截断的首行
    return lines.slice(Math.max(0, lines.length - tailN))
  } finally {
    await fh.close()
  }
}

/** 删除越界保护：path 的真实路径必须落在某个 root（真实路径）内部，否则抛错。 */
export async function assertPathWithinRoots(path: string, roots: string[]): Promise<void> {
  let realTarget: string
  try {
    realTarget = await realpath(path)
  } catch {
    realTarget = resolve(path)
  }
  for (const root of roots) {
    let realRoot: string
    try {
      realRoot = await realpath(root)
    } catch {
      realRoot = resolve(root)
    }
    const withSep = realRoot.endsWith(sep) ? realRoot : realRoot + sep
    if (realTarget === realRoot || realTarget.startsWith(withSep)) return
  }
  throw new Error(`拒绝删除：路径越界（不在允许的会话根目录内）: ${path}`)
}
