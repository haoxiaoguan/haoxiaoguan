import { createReadStream, createWriteStream } from 'node:fs'
import { rename, utimes, rm, stat } from 'node:fs/promises'
import { once } from 'node:events'
import { processRolloutLine, type SessionMetaAccumulator } from './codex-rollout-rewrite'

// 大 rollout 文件（>512MB 单字符串读不进 V8）的流式扫描/改写。按字节切行（仅 0x0A），
// 保留 \r\n / \n / 末行无换行；session_meta 是小行（文件头），逐行 JSON.parse 改写；
// 超大单行（不可能是 session_meta）原样透传不解码。改写写临时文件后原子替换并还原 mtime。
// 内存恒定：任意时刻只驻留一行。改写规则复用 processRolloutLine，与整文件路径同源。

/** 单行解码上限：session_meta 远小于此；超过则原样透传（避免对超大行 toString 触发 RangeError）。 */
const MAX_LINE_DECODE_BYTES = 16 * 1024 * 1024
const NL = 0x0a
const CR = 0x0d
const USER_EVENT_RE = /"user_message"|"user_input"/

export interface StreamRolloutResult {
  rewriteNeeded: boolean
  threadId?: string
  cwd?: string
  hasUserEvent: boolean
  originalSessionMetaLines: string[]
  sessionMetaCount: number
}

function newAccumulator(): SessionMetaAccumulator {
  return {
    rewriteNeeded: false,
    threadId: undefined,
    cwd: undefined,
    providers: [],
    originalSessionMetaLines: [],
    sessionMetaCount: 0,
  }
}

/** 按字节逐行（仅以 0x0A 切分；保留行内 \r 与末行无换行）。每行 buf 不含末尾 \n。 */
async function* iterateLineBuffers(path: string): AsyncGenerator<{ buf: Buffer; hadNewline: boolean }> {
  const stream = createReadStream(path)
  let rem: Buffer = Buffer.alloc(0)
  for await (const chunk of stream as AsyncIterable<Buffer>) {
    const merged: Buffer = rem.length > 0 ? Buffer.concat([rem, chunk]) : chunk
    let start = 0
    let nl = merged.indexOf(NL, start)
    while (nl !== -1) {
      yield { buf: merged.subarray(start, nl), hadNewline: true }
      start = nl + 1
      nl = merged.indexOf(NL, start)
    }
    rem = merged.subarray(start)
  }
  if (rem.length > 0) yield { buf: rem, hadNewline: false }
}

/** 把一行 buf 拆成 (line | null, ending, body)。line=null 表示超大行，不解码、原样写 body+ending。 */
function decodeLine(buf: Buffer, hadNewline: boolean): { line: string | null; ending: string; body: Buffer } {
  let body = buf
  let ending = ''
  if (hadNewline) {
    if (buf.length > 0 && buf[buf.length - 1] === CR) {
      body = buf.subarray(0, buf.length - 1)
      ending = '\r\n'
    } else {
      ending = '\n'
    }
  }
  if (body.length > MAX_LINE_DECODE_BYTES) return { line: null, ending, body }
  return { line: body.toString('utf8'), ending, body }
}

/** 流式扫描（只读）：等价 analyzeRollout 的元数据收集，不构造 nextText、内存恒定。 */
export async function streamScanRollout(path: string, target: string): Promise<StreamRolloutResult> {
  const acc = newAccumulator()
  let hasUserEvent = false
  for await (const { buf, hadNewline } of iterateLineBuffers(path)) {
    const { line } = decodeLine(buf, hadNewline)
    if (line === null) continue // 超大行不可能是 session_meta
    if (!hasUserEvent && USER_EVENT_RE.test(line)) hasUserEvent = true
    processRolloutLine(line, target, acc) // 仅累积，忽略返回（不写）
  }
  return {
    rewriteNeeded: acc.rewriteNeeded,
    threadId: acc.threadId,
    cwd: acc.cwd,
    hasUserEvent,
    originalSessionMetaLines: acc.originalSessionMetaLines,
    sessionMetaCount: acc.sessionMetaCount,
  }
}

async function writeChunk(out: NodeJS.WritableStream, data: string | Buffer): Promise<void> {
  if (!out.write(data)) await once(out, 'drain')
}

/** 流式改写：逐行重写 session_meta，写临时文件后原子替换并还原 mtime。内存恒定。 */
export async function streamRewriteRollout(path: string, target: string): Promise<void> {
  let originalMtime: Date | undefined
  try {
    originalMtime = (await stat(path)).mtime
  } catch {
    originalMtime = undefined
  }
  const tmp = `${path}.hxg-repair-${process.pid}.tmp`
  const out = createWriteStream(tmp)
  const acc = newAccumulator()
  try {
    for await (const { buf, hadNewline } of iterateLineBuffers(path)) {
      const { line, ending, body } = decodeLine(buf, hadNewline)
      if (line === null) {
        await writeChunk(out, body) // 超大行原样透传
      } else {
        await writeChunk(out, processRolloutLine(line, target, acc))
      }
      if (ending.length > 0) await writeChunk(out, ending)
    }
    await new Promise<void>((resolve, reject) => {
      out.on('error', reject)
      out.end(resolve)
    })
  } catch (err) {
    out.destroy()
    await rm(tmp, { force: true }).catch(() => {})
    throw err
  }
  await rename(tmp, path)
  if (originalMtime !== undefined) {
    await utimes(path, originalMtime, originalMtime).catch(() => {})
  }
}
