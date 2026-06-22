/** token / cost / number 格式化工具。 */

/** 短格式 token：>1M 显示 x.xM，>1K 显示 x.xK。 */
export function formatTokens(n: number): string {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`
  return n.toLocaleString()
}

/** 美元花费：<0.01 显示 4 位小数，否则 2 位。 */
export function formatCost(usd: number): string {
  if (usd < 0.01 && usd > 0) return `$${usd.toFixed(4)}`
  return `$${usd.toFixed(2)}`
}

/** 千分位数字。 */
export function formatNumber(n: number): string {
  return n.toLocaleString()
}

/** 百分比（0..1 → x.x%）。 */
export function formatPercent(ratio: number): string {
  return `${(ratio * 100).toFixed(1)}%`
}
