// Kiro 模型映射（纯函数，无副作用）。把客户端给的模型名归一化到 Kiro CodeWhisperer 接受的形态。
// 含模型 ID 映射表 / normalizeClaudeVersion / mapModelId（按线协议实现）。
// resolveCodeWhispererModelId：从 ListAvailableModels 结果启发式匹配大写内部 ID（P1-6 步骤 2）。

// 模型 ID 映射表：客户端别名 → Kiro 接受的点号版本。default 兜底用最新 sonnet。
const MODEL_ID_MAP: Record<string, string> = {
  // Claude 4.5 系列
  'claude-sonnet-4-5': 'claude-sonnet-4.5',
  'claude-sonnet-4.5': 'claude-sonnet-4.5',
  'claude-haiku-4-5': 'claude-haiku-4.5',
  'claude-haiku-4.5': 'claude-haiku-4.5',
  'claude-opus-4-5': 'claude-opus-4.5',
  'claude-opus-4.5': 'claude-opus-4.5',
  // Claude 4 系列
  'claude-sonnet-4': 'claude-sonnet-4',
  'claude-sonnet-4-20250514': 'claude-sonnet-4',
  // Claude 3.x 兼容（旧名 → 最新对应档）
  'claude-3-5-sonnet': 'claude-sonnet-4.5',
  'claude-3-opus': 'claude-sonnet-4.5',
  'claude-3-sonnet': 'claude-sonnet-4',
  'claude-3-haiku': 'claude-haiku-4.5',
  // 非 Claude 客户端兜底（OpenAI 等模型名 → sonnet）
  'gpt-4': 'claude-sonnet-4.5',
  'gpt-4o': 'claude-sonnet-4.5',
  'gpt-4-turbo': 'claude-sonnet-4.5',
  'gpt-3.5-turbo': 'claude-sonnet-4.5',
  default: 'claude-sonnet-4.5',
}

/**
 * 归一化 Claude 版本号：把 claude-{family}-{major}-{minor} 最后一段版本短横转点号。
 * 背景：部分客户端（如 Claude Code）不允许模型名出现 '.'，会把 'claude-opus-4.6' 写成
 * 'claude-opus-4-6'，原样透传给 Kiro 会被解析成 'claude-opus-4'（丢 minor → 丢 1M 上下文）。
 * 仅当 minor 是 1~2 位数字且其后不是更多数字时转换，避免误伤日期快照（claude-sonnet-4-20250514 不动）。
 */
export function normalizeClaudeVersion(modelId: string): string {
  return modelId.replace(
    /^(claude-(?:sonnet|haiku|opus))-(\d+)-(\d{1,2})(?=$|[^\d])/i,
    '$1-$2.$3',
  )
}

// CodeWhisperer 原生模型 ID 形态：全大写字母/数字/下划线且至少含一个下划线（如 CLAUDE_SONNET_4_20250514_V1_0）。
function isCodeWhispererModelId(modelId: string): boolean {
  return /^[A-Z0-9_]+$/.test(modelId) && modelId.includes('_')
}

/**
 * 把客户端模型名映射为 Kiro 接受的模型 ID。
 * 顺序：trim → 空串兜底 → CodeWhisperer 原生 ID 透传 → 归一化版本短横 → 别名表命中 →
 *      claude-(sonnet|haiku|opus)- 前缀向前兼容透传 → 完全未知兜底 default。
 */
export function mapModelId(model: string): string {
  let modelId = model.trim()
  if (modelId.length === 0) return MODEL_ID_MAP.default
  if (isCodeWhispererModelId(modelId)) return modelId
  modelId = normalizeClaudeVersion(modelId)
  const lower = modelId.toLowerCase()
  if (MODEL_ID_MAP[lower] !== undefined) return MODEL_ID_MAP[lower]
  if (/^claude-(sonnet|haiku|opus)-/.test(lower)) return modelId
  return MODEL_ID_MAP.default
}

// --- CodeWhisperer 大写内部 ID 映射（P1-6 步骤 2）---
// 注意：CodeWhisperer 端点行为待真实账号验证后默认启用。
// 当前作为实验路径，仅在 enableCodeWhisperer=true 时激活。

/**
 * 从 outwardId（对外模型名，如 `claude-sonnet-4.5`）提取匹配 token 集合：
 * 小写化，按 `-`/`.`/`_` 拆分，过滤空串，取 family（sonnet/haiku/opus）和数字版本段。
 * 例：`claude-sonnet-4-5` → tokens = ['claude','sonnet','4','5']
 */
function tokenize(id: string): string[] {
  return id.toLowerCase().split(/[-._]+/).filter((t) => t.length > 0)
}

/**
 * 计算两个 token 集合的重合度（交集大小除以候选集合大小），用于启发式排序。
 * 优先要求 family（sonnet/haiku/opus）匹配，不匹配直接返回 -1。
 */
function overlapScore(queryTokens: string[], candidateTokens: string[]): number {
  const FAMILIES = ['sonnet', 'haiku', 'opus']
  const queryFamily = queryTokens.find((t) => FAMILIES.includes(t))
  const candidateFamily = candidateTokens.find((t) => FAMILIES.includes(t))
  // family 不匹配 → 直接排除
  if (queryFamily === undefined || candidateFamily === undefined) return -1
  if (queryFamily !== candidateFamily) return -1

  const candidateSet = new Set(candidateTokens)
  let hits = 0
  for (const t of queryTokens) {
    if (candidateSet.has(t)) hits++
  }
  return candidateSet.size > 0 ? hits / candidateSet.size : 0
}

/**
 * 从 ListAvailableModels 结果中启发式匹配对外模型 ID 对应的 CodeWhisperer 大写内部 ID。
 *
 * 匹配策略：
 * 1. 把 outwardId（如 `claude-sonnet-4.5`）和每个 modelId（如 `CLAUDE_SONNET_4_5_20250514_V1_0`）
 *    都归一化为 token 集合（小写、按 `-`/`.`/`_` 拆分）。
 * 2. 仅匹配 CodeWhisperer 原生大写 ID（isCodeWhispererModelId 为 true）。
 * 3. family 必须匹配（sonnet/haiku/opus），否则排除。
 * 4. 取 token 重合度（hits/candidateSize）最高的候选；并列时取列表中靠前的。
 * 5. 无命中 → undefined（调用方回退到 AmazonQ 小写路径）。
 *
 * 纯函数，无副作用，可单测。
 */
export function resolveCodeWhispererModelId(
  outwardId: string,
  models: readonly { modelId: string }[],
): string | undefined {
  const queryTokens = tokenize(outwardId)
  if (queryTokens.length === 0) return undefined

  let best: string | undefined
  let bestScore = -1

  for (const m of models) {
    if (!isCodeWhispererModelId(m.modelId)) continue
    const candidateTokens = tokenize(m.modelId)
    const score = overlapScore(queryTokens, candidateTokens)
    if (score > bestScore) {
      bestScore = score
      best = m.modelId
    }
  }

  return bestScore > 0 ? best : undefined
}

/**
 * 反向映射：把 CodeWhisperer 大写内部 ID 转回可读对外名（供展示用）。
 * 策略：小写化 + 把 `_` 替换为 `-`，截取 family 前缀部分。
 * 例：`CLAUDE_SONNET_4_5_20250514_V1_0` → `claude-sonnet-4-5`（含版本，日期/V部分剥离）。
 * 无法识别时原样返回。
 */
export function codeWhispererToOutward(modelId: string): string {
  if (!isCodeWhispererModelId(modelId)) return modelId
  // 小写 + 下划线转短横
  const lower = modelId.toLowerCase().replace(/_/g, '-')
  // 匹配 claude-{family}-{major}（可选 minor：1-2 位，且后面不跟更多数字）前缀。
  // (?:-(\d{1,2})(?!\d))? 确保 minor 段不匹配日期数字（如 20250514 中的 20 是 2 位但后面跟 2 更多数字）。
  // 用负向前瞻 (?!\\d) 确保 minor 后不紧跟数字，避免把日期前两位误当 minor。
  const m = lower.match(/^(claude-(?:sonnet|haiku|opus)-\d+(?:-\d{1,2}(?!\d))?)/)
  return m !== null ? m[1] : lower
}
