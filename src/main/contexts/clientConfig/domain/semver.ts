// 语义化版本解析/比较 —— 对称移植 cc-switch parse_semver / compare_semver（misc.rs）。
// core 三段 + 预发布段；patch 用 number 容纳 codex 时间戳式版本（0.1.2505172116，
// 在 JS Number.MAX_SAFE_INTEGER 内）。任一无法解析时比较返回 null，调用方保守处理。

export interface ParsedSemver {
  core: [number, number, number]
  pre: string[]
}

/** "2.1.156" / "2.1.156-beta.1" / "2.1.156+build" → core 三段 + 预发布段。 */
export function parseSemver(v: string): ParsedSemver | null {
  const coreAndPre = v.trim().split('+')[0] ?? ''
  const dash = coreAndPre.indexOf('-')
  const core = dash === -1 ? coreAndPre : coreAndPre.slice(0, dash)
  const pre = dash === -1 ? undefined : coreAndPre.slice(dash + 1)
  const parts = core.split('.')
  if (parts.length !== 3) return null
  const nums = parts.map((p) => Number(p))
  if (nums.some((n) => !Number.isInteger(n) || n < 0)) return null
  return {
    core: [nums[0], nums[1], nums[2]],
    pre: pre === undefined ? [] : pre.split('.'),
  }
}

const isNumeric = (s: string): boolean => /^\d+$/.test(s)

/**
 * 比较两个版本号，返回 -1 | 0 | 1；任一无法解析返回 null。
 * semver 规则：主版本三段优先；core 相等时「有预发布 < 无预发布」；预发布段逐段比
 * （数字段按数值、数字段 < 非数字段、非数字段按 ASCII、前缀相同则段更多者更大）。
 */
export function compareSemver(a: string, b: string): -1 | 0 | 1 | null {
  const pa = parseSemver(a)
  const pb = parseSemver(b)
  if (pa === null || pb === null) return null

  for (let i = 0; i < 3; i++) {
    if (pa.core[i] !== pb.core[i]) return pa.core[i] < pb.core[i] ? -1 : 1
  }

  const aPre = pa.pre.length > 0
  const bPre = pb.pre.length > 0
  if (aPre && !bPre) return -1
  if (!aPre && bPre) return 1
  if (!aPre && !bPre) return 0

  const n = Math.min(pa.pre.length, pb.pre.length)
  for (let i = 0; i < n; i++) {
    const x = pa.pre[i]
    const y = pb.pre[i]
    const xn = isNumeric(x)
    const yn = isNumeric(y)
    if (xn && yn) {
      const nx = Number(x)
      const ny = Number(y)
      if (nx !== ny) return nx < ny ? -1 : 1
    } else if (xn !== yn) {
      return xn ? -1 : 1 // 数字段 < 非数字段
    } else if (x !== y) {
      return x < y ? -1 : 1 // 非数字段按 ASCII
    }
  }
  if (pa.pre.length !== pb.pre.length) return pa.pre.length < pb.pre.length ? -1 : 1
  return 0
}
