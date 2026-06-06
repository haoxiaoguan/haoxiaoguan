// 受控区块（managed-block）三态安全引擎 —— 纯函数，无 I/O。
//
// 用途：写「用户也会手动编辑」的支持注释的配置文件（Codex config.toml / Hermes yaml / env / json5）时，
// 用成对注释标记圈出「号小管管理的区域」，保证：
//   ① 只动自己的块、绝不覆盖用户手写内容（块外内容原样保留）；
//   ② 标记损坏（重复 / 缺失 / 顺序错）→ 判为 protected，调用方据此**拒绝一切写**并引导用户修复，
//      宁可不写也不冒险破坏用户配置。
//
// 纯 JSON 配置（settings.json / opencode.json）不用本机制，走「键级合并」（只改自己的键）。

export interface ManagedBlockMarkers {
  /** 起始标记整行（含所在文件的注释前缀）。 */
  begin: string
  /** 结束标记整行。 */
  end: string
}

export type ManagedBlockState = 'unmanaged' | 'ready' | 'protected'

export interface ManagedBlockParse {
  state: ManagedBlockState
  /** state==='ready' 时：受控块内部内容（不含两行标记本身）。 */
  block?: string
  /** state==='protected' 时：损坏原因（给用户的修复引导）。 */
  reason?: string
}

/** 默认标记（中性命名）。注释前缀用 `#`，适配 TOML / YAML / env；json5 调用方自传 `//` 前缀标记。 */
export const DEFAULT_MARKERS: ManagedBlockMarkers = {
  begin: '# >>> HAOXIAOGUAN MANAGED BEGIN — 请勿手动编辑此区块 >>>',
  end: '# <<< HAOXIAOGUAN MANAGED END <<<',
}

/** 受控块损坏时抛出；调用方捕获后应拒绝写入并提示用户手动修复标记。 */
export class ManagedBlockProtectedError extends Error {
  constructor(reason: string) {
    super(reason)
    this.name = 'ManagedBlockProtectedError'
  }
}

function findMarkers(lines: string[], markers: ManagedBlockMarkers): { begin: number[]; end: number[] } {
  const begin: number[] = []
  const end: number[] = []
  const b = markers.begin.trim()
  const e = markers.end.trim()
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i].trim()
    if (l === b) begin.push(i)
    else if (l === e) end.push(i)
  }
  return { begin, end }
}

/**
 * 解析文件内容的受控块状态。
 * - 无任何标记 → unmanaged（可注入）。
 * - 恰好一对、begin 在 end 之前 → ready（可读/替换），block 为块内内容。
 * - 其余（重复 / 只有一侧 / 顺序错）→ protected（拒绝一切写）。
 */
export function parseManagedBlock(
  content: string,
  markers: ManagedBlockMarkers = DEFAULT_MARKERS,
): ManagedBlockParse {
  const lines = content.split('\n')
  const { begin, end } = findMarkers(lines, markers)
  if (begin.length === 0 && end.length === 0) return { state: 'unmanaged' }
  if (begin.length !== 1 || end.length !== 1) {
    return { state: 'protected', reason: `受控标记不成对（begin×${begin.length}, end×${end.length}）` }
  }
  if (begin[0] >= end[0]) {
    return { state: 'protected', reason: '结束标记出现在起始标记之前或同一行' }
  }
  return { state: 'ready', block: lines.slice(begin[0] + 1, end[0]).join('\n') }
}

/**
 * 注入或替换受控块内容。
 * - unmanaged → 在文件末尾追加（前置一空行分隔）。
 * - ready → 原地替换块内内容，块外原样保留。
 * - protected → 抛 ManagedBlockProtectedError（不写）。
 * 幂等：同样的 body 重复 upsert 结果一致。
 */
export function upsertManagedBlock(
  content: string,
  body: string,
  markers: ManagedBlockMarkers = DEFAULT_MARKERS,
): string {
  const parsed = parseManagedBlock(content, markers)
  if (parsed.state === 'protected') {
    throw new ManagedBlockProtectedError(parsed.reason ?? '受控块已损坏')
  }
  if (parsed.state === 'unmanaged') {
    const blockText = `${markers.begin}\n${body}\n${markers.end}\n`
    if (content.length === 0) return blockText
    const base = content.endsWith('\n') ? content : content + '\n'
    return `${base}\n${blockText}`
  }
  // ready：替换块内内容（保留块外）。
  const lines = content.split('\n')
  const { begin, end } = findMarkers(lines, markers)
  const next = [
    ...lines.slice(0, begin[0]),
    markers.begin,
    ...body.split('\n'),
    markers.end,
    ...lines.slice(end[0] + 1),
  ]
  return next.join('\n')
}

/**
 * 移除受控块（含其前的一空行分隔，若是我们加的）。
 * - unmanaged → 原样返回。
 * - ready → 删除块、保留块外。
 * - protected → 抛错（不动）。
 */
export function removeManagedBlock(
  content: string,
  markers: ManagedBlockMarkers = DEFAULT_MARKERS,
): string {
  const parsed = parseManagedBlock(content, markers)
  if (parsed.state === 'unmanaged') return content
  if (parsed.state === 'protected') {
    throw new ManagedBlockProtectedError(parsed.reason ?? '受控块已损坏')
  }
  const lines = content.split('\n')
  const { begin, end } = findMarkers(lines, markers)
  let start = begin[0]
  // 吞掉块前那一个空行分隔（注入时我们加的）。
  if (start > 0 && lines[start - 1].trim() === '') start -= 1
  const next = [...lines.slice(0, start), ...lines.slice(end[0] + 1)]
  return next.join('\n')
}
