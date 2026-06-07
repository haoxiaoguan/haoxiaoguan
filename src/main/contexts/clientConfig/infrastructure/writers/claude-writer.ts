// Claude Code 写入器（switch 模式，JSON 键级合并）。
// 配置：~/.claude/settings.json 的 env 子对象——只动 ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL +
// 分级映射 ANTHROPIC_DEFAULT_HAIKU/SONNET/OPUS_MODEL，保留用户其余 env 与顶层键。热生效、无需重启。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseJsonObject, stringifyJson, isObject } from '../config-text'

// 模型分级映射 tier → env 键（settings.modelMap.{haiku,sonnet,opus}）。
const TIER_ENV = {
  haiku: 'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  sonnet: 'ANTHROPIC_DEFAULT_SONNET_MODEL',
  opus: 'ANTHROPIC_DEFAULT_OPUS_MODEL',
} as const

const KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
] as const

/** 从 settings.modelMap 读分级模型(各 tier 可空)。 */
function readModelMap(settings: Record<string, unknown> | undefined): {
  haiku?: string
  sonnet?: string
  opus?: string
} {
  const m = settings?.modelMap
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return {}
  const r = m as Record<string, unknown>
  const pick = (k: string): string | undefined => (typeof r[k] === 'string' && (r[k] as string).length > 0 ? (r[k] as string) : undefined)
  return { haiku: pick('haiku'), sonnet: pick('sonnet'), opus: pick('opus') }
}

export class ClaudeWriter implements ClientConfigWriter {
  readonly clientId = 'claude' as const
  readonly writeMode = 'switch' as const
  private readonly settingsPath: string

  constructor(settingsPath: string) {
    this.settingsPath = settingsPath
  }

  configFiles(): string[] {
    return [this.settingsPath]
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    const obj = parseJsonObject(current[this.settingsPath] ?? null, this.settingsPath)
    const env = isObject(obj.env) ? { ...obj.env } : {}
    env.ANTHROPIC_BASE_URL = input.baseUrl
    env.ANTHROPIC_AUTH_TOKEN = input.apiKey
    if (input.model !== undefined && input.model.length > 0) env.ANTHROPIC_MODEL = input.model
    else delete env.ANTHROPIC_MODEL
    // 分级模型映射:有值则写对应 env,无值则清除(避免残留旧映射)。
    const modelMap = readModelMap(input.settings)
    for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
      const v = modelMap[tier]
      if (v !== undefined) env[TIER_ENV[tier]] = v
      else delete env[TIER_ENV[tier]]
    }
    obj.env = env
    return { [this.settingsPath]: stringifyJson(obj) }
  }

  renderClear(current: FileBundle, _profileId: string): FileBundle {
    const raw = current[this.settingsPath] ?? null
    if (raw === null) return {}
    const obj = parseJsonObject(raw, this.settingsPath)
    if (isObject(obj.env)) {
      const env = { ...obj.env }
      for (const k of KEYS) delete env[k]
      obj.env = env
    }
    return { [this.settingsPath]: stringifyJson(obj) }
  }
}
