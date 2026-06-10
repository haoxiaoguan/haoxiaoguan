// 生成 Codex model_catalog_json 文件内容。
//
// 关键认知（对照 AiMaMi 能工作的配置）：当 config.toml 顶层 model_provider 指向自定义 provider 时，
// Codex 桌面 App **不再自动显示** models_cache.json 的原生模型 —— 菜单完全由 model_catalog_json 决定。
// 所以 catalog 必须同时包含「原生模型 + 非原生(账号池 Claude / 第三方 relay)」全部条目。
//
// 条目结构必须完整（克隆 models_cache 真实条目，含 base_instructions/model_messages 等），AiMaMi 即如此；
// 精简条目可能不被 App 接受。约束：
//   - 数值字段(priority/context_window/...)必须是**整数(i32)**，浮点会触发 "expected i32" 解析失败；
//   - 每条加 supports_websockets=false（与 provider 一致，Codex 0.135+ 强制 HTTP-only）；
//   - 只有 visibility="list" 且 supported_in_api=true 的条目进入选择器（原生条目保留其原始标志）。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dotDir } from '../../../platform/persistence/paths'

/** catalog 需要补充的非原生模型（账号池 / 第三方）。 */
export interface CatalogModelInput {
  id: string
  displayName?: string
  contextLength?: number
}

/** models_cache 不可读时的最小原生模板（保证第三方条目仍有可用结构）。 */
function fallbackTemplate(): Record<string, unknown> {
  return {
    slug: 'gpt-5.5',
    display_name: 'GPT-5.5',
    description: 'Frontier model.',
    default_reasoning_level: 'medium',
    supported_reasoning_levels: [
      { effort: 'low', description: 'Fast responses with lighter reasoning' },
      { effort: 'medium', description: 'Balances speed and reasoning depth' },
      { effort: 'high', description: 'Greater reasoning depth' },
    ],
    shell_type: 'shell_command',
    visibility: 'list',
    supported_in_api: true,
    priority: 9,
    context_window: 272000,
    max_context_window: 272000,
    effective_context_window_percent: 95,
    supports_reasoning_summaries: true,
    default_reasoning_summary: 'none',
    support_verbosity: true,
    default_verbosity: 'low',
    apply_patch_tool_type: 'freeform',
    web_search_tool_type: 'text',
    supports_parallel_tool_calls: true,
    supports_image_detail_original: true,
    experimental_supported_tools: [],
    input_modalities: ['text'],
    supports_search_tool: true,
    // ModelInfo 必填字段(缺失会让整个 catalog parse 失败 → /model 空)。取值对齐真实 models_cache 条目。
    truncation_policy: { mode: 'tokens', limit: 10000 },
    base_instructions: '',
  }
}

/** 读 ~/.codex/models_cache.json：返回原生条目数组 + 用作第三方模板的首条。 */
function readModelsCache(modelsCachePath?: string): {
  natives: Record<string, unknown>[]
  template: Record<string, unknown>
} {
  const path = modelsCachePath ?? join(dotDir('codex'), 'models_cache.json')
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as { models?: unknown }
    const list = Array.isArray(raw) ? raw : raw.models
    if (Array.isArray(list) && list.length > 0 && typeof list[0] === 'object' && list[0] !== null) {
      return { natives: list as Record<string, unknown>[], template: list[0] as Record<string, unknown> }
    }
  } catch {
    /* 退兜底 */
  }
  return { natives: [], template: fallbackTemplate() }
}

/** 整数化（i32 安全）；非有限值退默认。 */
function intOr(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, Math.floor(value)) : fallback
}

/** 第三方条目：克隆模板（完整结构）+ 覆盖身份/上下文/标志字段。 */
function thirdPartyEntry(
  template: Record<string, unknown>,
  m: CatalogModelInput,
  index: number,
): Record<string, unknown> {
  const ctx = intOr(m.contextLength, intOr(template.context_window, 200000))
  const entry: Record<string, unknown> = { ...template }
  entry.slug = m.id
  // 调用方提供 displayName 时原样使用（用户填写的菜单显示名按填写内容保存）；未提供时回退「<id>（号小管）」。
  entry.display_name = m.displayName !== undefined ? m.displayName : `${m.id}（号小管）`
  entry.description = m.displayName !== undefined ? m.displayName : `${m.id} · 经号小管反代接入`
  entry.priority = 100 + index // 整数，排在原生(9~50)之后
  entry.context_window = ctx
  entry.max_context_window = ctx
  entry.visibility = 'list'
  entry.supported_in_api = true
  entry.supports_websockets = false
  // 原生专属的引导/升级提示对第三方无意义，去掉避免错配文案。
  delete entry.availability_nux
  delete entry.upgrade
  return entry
}

/** 原生条目：保留 models_cache 原样（slug/标志），仅补 supports_websockets=false。 */
function nativeEntry(e: Record<string, unknown>): Record<string, unknown> {
  return { ...e, supports_websockets: false }
}

/**
 * 生成 catalog 条目数组：原生(来自 models_cache) + 第三方(克隆模板)。
 * includeNative=false 时只产第三方（测试/特殊场景用）。
 */
export function buildCodexCatalogEntries(
  thirdParty: CatalogModelInput[],
  opts?: { modelsCachePath?: string; includeNative?: boolean },
): Record<string, unknown>[] {
  const { natives, template } = readModelsCache(opts?.modelsCachePath)
  const includeNative = opts?.includeNative !== false
  const nativeEntries = includeNative ? natives.map(nativeEntry) : []
  // 仅在「原生也在菜单里」(ON/真共存)时，跳过与原生同名的第三方，避免菜单重复/路由歧义。
  // OFF(切换式 includeNative=false)是要用第三方**替换**原生：此时没有原生条目，必须保留同名第三方，
  // 否则若第三方模型恰好叫 gpt-5.5(撞原生 slug)会被滤光 → catalog 空 → App 回退显示原生(就是这个 bug)。
  const nativeSlugs = new Set(
    natives.map((e) => (typeof e.slug === 'string' ? e.slug : '')).filter((s) => s.length > 0),
  )
  const tpEntries = thirdParty
    .filter((m) => !includeNative || !nativeSlugs.has(m.id))
    .map((m, i) => thirdPartyEntry(template, m, i))
  return [...nativeEntries, ...tpEntries]
}

/** 生成 catalog 文件内容（{ models: [...] }，Codex 要求顶层是 models 数组）。 */
export function buildCodexModelCatalogFile(
  thirdParty: CatalogModelInput[],
  opts?: { modelsCachePath?: string; includeNative?: boolean },
): string {
  return JSON.stringify({ models: buildCodexCatalogEntries(thirdParty, opts) }, null, 2)
}
