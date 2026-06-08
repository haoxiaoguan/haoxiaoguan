// Claude Code 写入器（switch 模式，JSON 键级合并）。
// 配置：~/.claude/settings.json 的 env 子对象——只动 ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL +
// 分级映射 ANTHROPIC_DEFAULT_<TIER>_MODEL（实际模型，可带 [1M] 后缀）与 _MODEL_NAME（/model 菜单显示名），
// 保留用户其余 env 与顶层键。热生效、无需重启。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseJsonObject, stringifyJson, isObject } from '../config-text'

// 模型分级映射 tier → env 键对（实际模型 / 显示名）。settings.modelMap.{haiku,sonnet,opus} = { model, name }。
const TIER_ENV = {
  haiku: { model: 'ANTHROPIC_DEFAULT_HAIKU_MODEL', name: 'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME' },
  sonnet: { model: 'ANTHROPIC_DEFAULT_SONNET_MODEL', name: 'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME' },
  opus: { model: 'ANTHROPIC_DEFAULT_OPUS_MODEL', name: 'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME' },
} as const

const KEYS = [
  'ANTHROPIC_BASE_URL',
  'ANTHROPIC_AUTH_TOKEN',
  'ANTHROPIC_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL',
  'ANTHROPIC_DEFAULT_SONNET_MODEL',
  'ANTHROPIC_DEFAULT_OPUS_MODEL',
  'ANTHROPIC_DEFAULT_HAIKU_MODEL_NAME',
  'ANTHROPIC_DEFAULT_SONNET_MODEL_NAME',
  'ANTHROPIC_DEFAULT_OPUS_MODEL_NAME',
] as const

interface TierModel {
  model?: string
  name?: string
}

/** 从 settings.modelMap 读分级模型(各 tier 的 model/name 可空)。兼容旧版字符串值(仅 model)。 */
function readModelMap(settings: Record<string, unknown> | undefined): {
  haiku: TierModel
  sonnet: TierModel
  opus: TierModel
} {
  const out: { haiku: TierModel; sonnet: TierModel; opus: TierModel } = { haiku: {}, sonnet: {}, opus: {} }
  const m = settings?.modelMap
  if (typeof m !== 'object' || m === null || Array.isArray(m)) return out
  const r = m as Record<string, unknown>
  const str = (v: unknown): string | undefined => (typeof v === 'string' && v.length > 0 ? v : undefined)
  for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
    const v = r[tier]
    if (typeof v === 'string') {
      out[tier] = { model: str(v) } // 旧版:值为模型字符串
    } else if (typeof v === 'object' && v !== null && !Array.isArray(v)) {
      const o = v as Record<string, unknown>
      out[tier] = { model: str(o.model), name: str(o.name) }
    }
  }
  return out
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
    // 分级模型映射:实际模型 + 显示名,有值则写对应 env,无值则清除(避免残留旧映射)。
    const modelMap = readModelMap(input.settings)
    for (const tier of ['haiku', 'sonnet', 'opus'] as const) {
      const { model, name } = modelMap[tier]
      if (model !== undefined) env[TIER_ENV[tier].model] = model
      else delete env[TIER_ENV[tier].model]
      if (name !== undefined) env[TIER_ENV[tier].name] = name
      else delete env[TIER_ENV[tier].name]
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
