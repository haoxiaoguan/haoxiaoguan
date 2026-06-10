import { readFile } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import { atomicWrite } from '../../../platform/fs/atomic-write'

export interface RolloutRewriteResult {
  ok: boolean
  oldProvider?: string
}

/**
 * 改写 rollout 文件首行(session_meta)的 payload.model_provider。
 * 只动这一个字段,逐字节保留其余行;原子写。首行非 session_meta / 无 payload / 文件缺失 → ok:false。
 */
export async function rewriteRolloutProvider(path: string, target: string): Promise<RolloutRewriteResult> {
  if (!existsSync(path)) return { ok: false }
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch {
    return { ok: false }
  }
  const nl = text.indexOf('\n')
  const firstLine = nl === -1 ? text : text.slice(0, nl)
  const rest = nl === -1 ? '' : text.slice(nl) // 含前导 \n
  let head: Record<string, unknown>
  try {
    head = JSON.parse(firstLine)
  } catch {
    return { ok: false }
  }
  const payload = head.payload
  if (head.type !== 'session_meta' || typeof payload !== 'object' || payload === null) return { ok: false }
  const p = payload as Record<string, unknown>
  const oldProvider = typeof p.model_provider === 'string' ? p.model_provider : undefined
  p.model_provider = target
  await atomicWrite(path, JSON.stringify(head) + rest)
  return { ok: true, oldProvider }
}
