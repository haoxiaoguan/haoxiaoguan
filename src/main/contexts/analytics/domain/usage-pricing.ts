/**
 * 用量费用计算（USD）。定价数据从 DB model_pricing 表读取。
 *
 * 关键增强（对比 usage 上下文的 usage-pricing.ts）：按 agent 协议区分缓存语义——
 *   - codex / gemini-cli 协议的 input_tokens 包含 cacheRead，计费前需扣减
 *     （freshInput = max(input - cacheRead, 0)），避免 input 重复计费。
 *   - claude / kiro / qoder 协议的 input_tokens 已是 fresh input，不扣。
 * 对应 cc-switch CostCalculator.calculate_for_app 的 input_includes_cache_read 逻辑。
 *
 * 模型名归一：lowercase + 点号转短横，再以去日期后缀 / 去 reasoning-effort 后缀兜底匹配。
 */
import type { ModelPricingRow, PricingConfig } from './usage-event'

export interface TokenSums {
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheCreationTokens: number
}

/** input_tokens 包含 cacheRead 的 agent（OpenAI/Gemini 协议风格）。 */
const CACHE_INCLUSIVE_AGENTS = new Set(['codex', 'gemini-cli'])

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

/** normId → 定价行 的查询索引。由调用方通过 buildPricingIndex 预构建。 */
export function buildPricingIndex(rows: ModelPricingRow[]): Map<string, ModelPricingRow> {
  const m = new Map<string, ModelPricingRow>()
  for (const row of rows) {
    const key = normId(row.modelId)
    if (!m.has(key)) m.set(key, row)
    const noDate = key.replace(/-\d{6,8}$/, '')
    if (noDate !== key && !m.has(noDate)) m.set(noDate, row)
  }
  return m
}

/** 查模型定价；找不到返回 null（→ 费用 0）。 */
export function findPrice(
  model: string,
  index: Map<string, ModelPricingRow>,
): ModelPricingRow | null {
  if (!model) return null
  const key = normId(model)
  if (index.has(key)) return index.get(key)!

  let k = key.replace(/-\d{6,8}$/, '')
  for (let guard = 0; guard < 4; guard++) {
    if (index.has(k)) return index.get(k)!
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
  return index.has(k) ? index.get(k)! : null
}

/**
 * 按 agent 协议区分缓存语义后计算费用。
 *
 * - codex/gemini-cli：input_tokens 含 cacheRead → freshInput = max(input - cacheRead, 0)
 * - 其他 agent：input_tokens 已是 fresh input，不扣
 *
 * 返回各项 cost + total。未计价模型全部为 0。
 */
export function calculateForAgent(
  agentId: string,
  model: string,
  sums: TokenSums,
  index: Map<string, ModelPricingRow>,
  config?: PricingConfig,
): {
  inputCostUsd: number
  outputCostUsd: number
  cacheReadCostUsd: number
  cacheCreationCostUsd: number
  totalCostUsd: number
} {
  const p = findPrice(model, index)
  if (!p) {
    return {
      inputCostUsd: 0,
      outputCostUsd: 0,
      cacheReadCostUsd: 0,
      cacheCreationCostUsd: 0,
      totalCostUsd: 0,
    }
  }

  const inputIncludesCacheRead = CACHE_INCLUSIVE_AGENTS.has(agentId)
  const freshInput = inputIncludesCacheRead
    ? Math.max(sums.inputTokens - sums.cacheReadTokens, 0)
    : sums.inputTokens

  const million = 1_000_000
  const inputCost = (freshInput * p.inputCostPerMillion) / million
  const outputCost = (sums.outputTokens * p.outputCostPerMillion) / million
  const cacheReadCost = (sums.cacheReadTokens * p.cacheReadCostPerMillion) / million
  const cacheCreationCost = (sums.cacheCreationTokens * p.cacheCreationCostPerMillion) / million

  const multiplier = config?.costMultiplier ?? 1.0
  const total = (inputCost + outputCost + cacheReadCost + cacheCreationCost) * multiplier

  return {
    inputCostUsd: inputCost,
    outputCostUsd: outputCost,
    cacheReadCostUsd: cacheReadCost,
    cacheCreationCostUsd: cacheCreationCost,
    totalCostUsd: total,
  }
}
