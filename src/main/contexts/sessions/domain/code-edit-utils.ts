// 代码改动行数（churn=新增+删除）工具。只算结构化编辑，不持久化任何正文。
export function countLines(s?: string): number {
  return s ? s.split('\n').length : 0
}

function isObj(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** Claude 编辑类 tool_use 的 churn；非编辑工具返回 0 */
export function claudeEditChurn(name: string, input: unknown): number {
  if (!isObj(input)) return 0
  switch (name) {
    case 'Write':
      return countLines(typeof input.content === 'string' ? input.content : undefined)
    case 'Edit':
      return (
        countLines(typeof input.old_string === 'string' ? input.old_string : undefined) +
        countLines(typeof input.new_string === 'string' ? input.new_string : undefined)
      )
    case 'MultiEdit': {
      const edits = Array.isArray(input.edits) ? input.edits : []
      let sum = 0
      for (const e of edits) {
        if (!isObj(e)) continue
        sum +=
          countLines(typeof e.old_string === 'string' ? e.old_string : undefined) +
          countLines(typeof e.new_string === 'string' ? e.new_string : undefined)
      }
      return sum
    }
    case 'NotebookEdit':
      return countLines(typeof input.new_source === 'string' ? input.new_source : undefined)
    default:
      return 0
  }
}

/** apply_patch 信封文本的 churn：+ 行（非 +++）与 - 行（非 ---），跳过 *** 头与 @@ */
export function patchChurn(patch: string): number {
  let n = 0
  for (const line of patch.split('\n')) {
    if (line.startsWith('*** ') || line.startsWith('@@')) continue
    if (line.startsWith('+++') || line.startsWith('---')) continue
    if (line[0] === '+' || line[0] === '-') n++
  }
  return n
}
