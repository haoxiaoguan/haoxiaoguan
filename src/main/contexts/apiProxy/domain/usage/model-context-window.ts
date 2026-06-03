// 模型 → 上下文窗口 token 数（纯函数）。默认 200k；版本 ≥ 4.6 或 major ≥ 5 → 1M。
const DEFAULT_WINDOW = 200_000
const LARGE_WINDOW = 1_000_000

const VERSION_RE = /claude-(?:opus|sonnet|haiku)-(\d+)[.-](\d+)/

export function getContextTokensForModel(model: string): number {
  const m = (model ?? '').toLowerCase()
  const match = VERSION_RE.exec(m)
  if (match !== null) {
    const major = Number.parseInt(match[1], 10)
    const minor = Number.parseInt(match[2], 10)
    if (Number.isFinite(major) && Number.isFinite(minor)) {
      if (major > 4) return LARGE_WINDOW
      if (major === 4 && minor >= 6) return LARGE_WINDOW
      return DEFAULT_WINDOW
    }
  }
  return DEFAULT_WINDOW
}
