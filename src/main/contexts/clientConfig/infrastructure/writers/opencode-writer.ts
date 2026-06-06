// OpenCode 写入器（additive 模式，多供应商共存）。
// 配置：~/.config/opencode/opencode.json 的 provider.<id> 子对象——每份接入档独立一段，
// 互不覆盖（号小管账号模型与第三方模型可同时出现在模型菜单）。默认指针写顶层 model。
// 不变式：只动属于本档的 provider.<hxg-id>（与 default 指针），保留用户其余 provider/mcp/plugin 等。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseJsonObject, stringifyJson, isObject } from '../config-text'

const OPENCODE_SCHEMA = 'https://opencode.ai/config.json'

/** 本档在 opencode.json 中的 provider 键（稳定、可识别为号小管所写，便于精准移除）。 */
export function opencodeProviderId(profileId: string): string {
  return `hxg-${profileId}`
}

export class OpenCodeWriter implements ClientConfigWriter {
  readonly clientId = 'opencode' as const
  readonly writeMode = 'additive' as const
  private readonly configPath: string

  constructor(configPath: string) {
    this.configPath = configPath
  }

  configFiles(): string[] {
    return [this.configPath]
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    const raw = current[this.configPath] ?? null
    const obj = parseJsonObject(raw, this.configPath)
    if (raw === null && obj['$schema'] === undefined) obj['$schema'] = OPENCODE_SCHEMA

    const pid = opencodeProviderId(input.profileId)
    const provider = isObject(obj.provider) ? { ...obj.provider } : {}
    const models: Record<string, unknown> = {}
    if (input.model !== undefined && input.model.length > 0) {
      models[input.model] = { name: input.model }
    }
    provider[pid] = {
      npm: '@ai-sdk/openai-compatible',
      name: input.name,
      options: { baseURL: input.baseUrl, apiKey: input.apiKey },
      models,
    }
    obj.provider = provider

    // 默认指针（仅在本次设为默认且有模型时改写顶层 model）。
    if (input.isDefault === true && input.model !== undefined && input.model.length > 0) {
      obj.model = `${pid}/${input.model}`
    }
    return { [this.configPath]: stringifyJson(obj) }
  }

  renderClear(current: FileBundle, profileId: string): FileBundle {
    const raw = current[this.configPath] ?? null
    if (raw === null) return {}
    const obj = parseJsonObject(raw, this.configPath)
    const pid = opencodeProviderId(profileId)
    if (isObject(obj.provider)) {
      const provider = { ...obj.provider }
      delete provider[pid]
      obj.provider = provider
    }
    // 只在默认指针指向本档时清除（不动用户/他档设定的 model）。
    if (typeof obj.model === 'string' && obj.model.startsWith(`${pid}/`)) {
      delete obj.model
    }
    return { [this.configPath]: stringifyJson(obj) }
  }
}
