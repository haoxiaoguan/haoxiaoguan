// OpenClaw 写入器（additive 模式，多供应商共存）。
// 配置：~/.openclaw/openclaw.json 的 models.providers.<hxg-id>（camelCase 字段）——每档独立一段共存。
// 默认指针是独立节点 agents.defaults.model.primary = '<providerKey>/<modelId>'。
// 不变式：只动本档 provider 段与（指向本档时的）默认指针,保留用户其余 provider/agents/env/tools。
// 注意：openclaw.json 实为 JSON5；MVP 用严格 JSON 解析(含注释则判损坏拒写,安全)。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseJsonObject, stringifyJson, isObject } from '../config-text'

/** 本档在 openclaw.json models.providers 下的键(稳定、可识别为号小管所写)。 */
export function openClawProviderId(profileId: string): string {
  return `hxg-${profileId}`
}

export class OpenClawWriter implements ClientConfigWriter {
  readonly clientId = 'openclaw' as const
  readonly writeMode = 'additive' as const
  private readonly configPath: string

  constructor(configPath: string) {
    this.configPath = configPath
  }

  configFiles(): string[] {
    return [this.configPath]
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    const obj = parseJsonObject(current[this.configPath] ?? null, this.configPath)
    const pid = openClawProviderId(input.profileId)

    const models = isObject(obj.models) ? { ...obj.models } : {}
    if (typeof models.mode !== 'string') models.mode = 'merge'
    const providers = isObject(models.providers) ? { ...models.providers } : {}
    const providerModels =
      input.model !== undefined && input.model.length > 0 ? [{ id: input.model, name: input.model }] : []
    providers[pid] = {
      baseUrl: input.baseUrl,
      apiKey: input.apiKey,
      api: 'openai-completions',
      models: providerModels,
    }
    models.providers = providers
    obj.models = models

    if (input.isDefault === true && input.model !== undefined && input.model.length > 0) {
      const agents = isObject(obj.agents) ? { ...obj.agents } : {}
      const defaults = isObject(agents.defaults) ? { ...agents.defaults } : {}
      defaults.model = { primary: `${pid}/${input.model}` }
      agents.defaults = defaults
      obj.agents = agents
    }
    return { [this.configPath]: stringifyJson(obj) }
  }

  renderClear(current: FileBundle, profileId: string): FileBundle {
    const raw = current[this.configPath] ?? null
    if (raw === null) return {}
    const obj = parseJsonObject(raw, this.configPath)
    const pid = openClawProviderId(profileId)

    if (isObject(obj.models) && isObject(obj.models.providers)) {
      const models = { ...obj.models }
      const providers = { ...(models.providers as Record<string, unknown>) }
      delete providers[pid]
      models.providers = providers
      obj.models = models
    }
    // 仅当默认指针指向本档时清除(不动他档/用户设定)。
    if (isObject(obj.agents) && isObject(obj.agents.defaults)) {
      const defaults = obj.agents.defaults as Record<string, unknown>
      const model = defaults.model
      if (isObject(model) && typeof model.primary === 'string' && model.primary.startsWith(`${pid}/`)) {
        const agents = { ...obj.agents }
        const newDefaults = { ...defaults }
        delete newDefaults.model
        agents.defaults = newDefaults
        obj.agents = agents
      }
    }
    return { [this.configPath]: stringifyJson(obj) }
  }
}
