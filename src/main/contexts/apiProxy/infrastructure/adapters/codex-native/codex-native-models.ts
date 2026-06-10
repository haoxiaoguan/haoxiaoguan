// 原生模型清单加载：读 ~/.codex/models_cache.json（Codex 自己维护的本机缓存），
// 取 slug/display_name/context_window 映射为 ModelInfo。读不到则退静态兜底列表。
// 这些是「ChatGPT 登录账号本身」的模型，请求经反代透传到 chatgpt.com/backend-api/codex。
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { dotDir } from '../../../../../platform/persistence/paths'
import type { ModelInfo } from '../../../domain/platform-adapter'

/** models_cache.json 单条（仅取用到的字段，其余忽略）。 */
interface CodexCachedModel {
  slug?: unknown
  display_name?: unknown
  context_window?: unknown
  max_context_window?: unknown
}

/** 静态兜底：缓存读不到时仍暴露已知原生模型，避免原生路完全不可用。 */
const STATIC_FALLBACK: ModelInfo[] = [
  { id: 'gpt-5.5', displayName: 'GPT-5.5', ownedBy: 'openai', supportsThinking: true },
  { id: 'gpt-5.4', displayName: 'GPT-5.4', ownedBy: 'openai', supportsThinking: true },
  { id: 'gpt-5.4-mini', displayName: 'GPT-5.4-Mini', ownedBy: 'openai', supportsThinking: true },
  { id: 'gpt-5.3-codex-spark', displayName: 'GPT-5.3-Codex-Spark', ownedBy: 'openai', supportsThinking: true },
  { id: 'codex-auto-review', displayName: 'Codex Auto Review', ownedBy: 'openai', supportsThinking: true },
]

function toModelInfo(m: CodexCachedModel): ModelInfo | null {
  if (typeof m.slug !== 'string' || m.slug.length === 0) return null
  const ctx = typeof m.context_window === 'number' ? m.context_window : undefined
  return {
    id: m.slug,
    displayName: typeof m.display_name === 'string' ? m.display_name : m.slug,
    ownedBy: 'openai',
    supportsThinking: true,
    ...(ctx !== undefined ? { contextLength: ctx } : {}),
  }
}

/** 读原生模型清单。cachePath 可注入（测试）；默认 ~/.codex/models_cache.json。 */
export function loadCodexNativeModels(cachePath?: string): ModelInfo[] {
  const path = cachePath ?? join(dotDir('codex'), 'models_cache.json')
  try {
    const raw = JSON.parse(readFileSync(path, 'utf8')) as unknown
    const list = Array.isArray(raw)
      ? (raw as CodexCachedModel[])
      : ((raw as { models?: unknown }).models as CodexCachedModel[] | undefined)
    if (Array.isArray(list)) {
      const models = list.map(toModelInfo).filter((m): m is ModelInfo => m !== null)
      if (models.length > 0) return models
    }
  } catch {
    /* 缓存缺失/损坏 → 退兜底 */
  }
  return STATIC_FALLBACK.slice()
}
