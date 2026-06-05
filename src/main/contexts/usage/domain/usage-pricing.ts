/**
 * 用量费用计算（USD）。定价数据见 model-pricing-data.ts（从 cc-switch 导出，147 条）。
 *
 * 模型名归一：两侧都做 lowercase + 点号转短横（claude-opus-4.8 ↔ claude-opus-4-8、
 * gpt-5.5 ↔ gpt-5-5），再以「去日期后缀」「去 reasoning/effort 后缀」做兜底匹配。
 * 匹配不到的模型（如自建中转 aimami_relay_*）→ 费用按 0 计（产品决策）。
 */
import { MODEL_PRICING, type ModelPriceRow } from './model-pricing-data'

export interface TokenSums {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** 常见 reasoning / effort 后缀，匹配不到时逐个剥离再试。 */
const STRIP_SUFFIXES = [
  '-thinking',
  '-xhigh',
  '-high',
  '-medium',
  '-low',
  '-minimal',
  '-max',
  '-spark',
]

function normId(model: string): string {
  return model.toLowerCase().replace(/\./g, '-')
}

/** normId → 定价行 的查询索引（精确键 + 去日期后缀兜底键）。 */
const INDEX: Map<string, ModelPriceRow> = (() => {
  const m = new Map<string, ModelPriceRow>()
  for (const row of MODEL_PRICING) {
    const key = normId(row.id)
    if (!m.has(key)) m.set(key, row)
    const noDate = key.replace(/-\d{6,8}$/, '')
    if (noDate !== key && !m.has(noDate)) m.set(noDate, row)
  }
  return m
})()

/** 查模型定价；找不到返回 null（→ 费用 0）。 */
export function findPrice(model: string): ModelPriceRow | null {
  if (!model) return null
  const key = normId(model)
  if (INDEX.has(key)) return INDEX.get(key)!

  let k = key.replace(/-\d{6,8}$/, '')
  for (let guard = 0; guard < 4; guard++) {
    if (INDEX.has(k)) return INDEX.get(k)!
    let stripped = k
    for (const s of STRIP_SUFFIXES) {
      if (k.endsWith(s)) {
        stripped = k.slice(0, -s.length)
        break
      }
    }
    if (stripped === k) break
    k = stripped
  }
  return INDEX.has(k) ? INDEX.get(k)! : null
}

/** 单模型一组 token 的费用（USD）。未计价 → 0。 */
export function costForModel(model: string, sums: TokenSums): number {
  const p = findPrice(model)
  if (!p) return 0
  return (
    (sums.inputTokens * p.inP +
      sums.outputTokens * p.outP +
      sums.cacheReadTokens * p.crP +
      sums.cacheCreationTokens * p.ccP) /
    1_000_000
  )
}

/** 汇总多模型行的总费用（USD）。 */
export function totalCostUsd(rows: Array<{ model: string } & TokenSums>): number {
  let usd = 0
  for (const r of rows) usd += costForModel(r.model, r)
  return usd
}
