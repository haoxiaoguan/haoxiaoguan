// 路由组合(Route Combo)领域模型 —— 灵感来自 9router 的「组合/Combos」。
//
// 组合 = 一条「命名的、有序的跨供应商降级链」，对外作为单个 model 名暴露给客户端。
// 链里每一跳是一个「别名前缀模型」字符串（如 `kr/claude-sonnet-4.5`），复用 platform-alias 的
// 别名寻址（见 [request-intent].resolveModelAlias）。请求带组合名进来时，反代按顺序逐跳尝试，
// 某跳「整体失败/限流/配额耗尽」才跌落到下一个不同供应商的跳（错误驱动的反应式回退）。
//
// 纯领域：只有类型 + 名字校验 + 启用步骤投影，不依赖 application/infrastructure。

export interface ComboStep {
  /** 别名前缀模型串，如 `kr/claude-sonnet-4.5` / `relay-<id>/deepseek-chat`。 */
  model: string
  /** 是否启用该跳（缺省视为 true）；Phase 2 的「临时禁用某跳而不删组合」。 */
  enabled?: boolean
}

export type ComboStrategy = 'fallback'

export interface RouteCombo {
  id: string
  /** 可路由名（无斜杠；客户端把它当 model 用）。 */
  name: string
  description?: string
  /** 有序链；数组顺序即优先级（自上而下）。 */
  steps: ComboStep[]
  /** MVP 仅 'fallback'（纯顺序兜底）。Phase 3 可加 round-robin。 */
  strategy: ComboStrategy
  /** 停用的组合不参与路由、不进 /v1/models。 */
  enabled: boolean
}

/** 组合名字符集：与 9router 对齐（字母数字 + `_.-`），且不得含 `/`（否则会被当别名前缀模型解析）。 */
export const COMBO_NAME_RE = /^[A-Za-z0-9_.-]+$/
export const COMBO_NAME_MAX = 64

/**
 * 组合显式寻址前缀 `cb/`。`cb/<comboName>` 永远按组合路由（即使带中转注入固定 key），
 * 用于「中转注入 + 号小管作供应商」时与同名原生(裸名→登录账号)/账号管理(平台别名/-hxg)消歧。
 * `cb` 不是平台别名（见 platform-alias），故 resolveModelAlias 不会把它当平台前缀剥离。
 */
export const COMBO_MODEL_PREFIX = 'cb/'

/** 组合名是否合法：非空、≤64、仅 [A-Za-z0-9_.-]、无斜杠。 */
export function isValidComboName(name: string): boolean {
  return (
    typeof name === 'string' &&
    name.length > 0 &&
    name.length <= COMBO_NAME_MAX &&
    !name.includes('/') &&
    COMBO_NAME_RE.test(name)
  )
}

/** 启用组合里「启用步骤」的模型串（保序）；停用步骤(enabled===false)剔除。 */
export function enabledStepModels(combo: RouteCombo): string[] {
  return combo.steps.filter((s) => s.enabled !== false).map((s) => s.model)
}
