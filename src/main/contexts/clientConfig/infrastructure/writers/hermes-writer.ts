// Hermes 写入器（additive 模式，多供应商共存）。
// 配置：~/.hermes/config.yaml 顶层 custom_providers[]（snake_case 字段，按 name upsert）——每档独立一项共存。
// 默认指针是顶层独立 model: 段（model.default=<modelId>, model.provider=<name>）。
// 不变式：只动本档 provider 项与（指向本档时的）默认指针,保留用户其余 provider/段。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseYamlObject, stringifyYaml } from '../hermes-yaml'

/** 本档在 custom_providers 中的 name（稳定、可识别为号小管所写）。 */
export function hermesProviderName(profileId: string): string {
  return `hxg-${profileId}`
}

function asArray(v: unknown): unknown[] {
  return Array.isArray(v) ? v : []
}
function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

export class HermesWriter implements ClientConfigWriter {
  readonly clientId = 'hermes' as const
  readonly writeMode = 'additive' as const
  private readonly configPath: string

  constructor(configPath: string) {
    this.configPath = configPath
  }

  configFiles(): string[] {
    return [this.configPath]
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    const obj = parseYamlObject(current[this.configPath] ?? null, this.configPath)
    const name = hermesProviderName(input.profileId)

    const element: Record<string, unknown> = {
      name,
      base_url: input.baseUrl,
      api_key: input.apiKey,
      api_mode: 'chat_completions',
    }
    if (input.model !== undefined && input.model.length > 0) {
      element.model = input.model // 单数:运行时/选择器读取
      element.models = { [input.model]: {} } // 复数:磁盘上以模型 id 为 key 的 dict
    }

    const list = asArray(obj.custom_providers).filter(
      (e) => !(isObject(e) && e.name === name),
    )
    list.push(element)
    obj.custom_providers = list

    if (input.isDefault === true) {
      const model = isObject(obj.model) ? { ...obj.model } : {}
      model.provider = name
      if (input.model !== undefined && input.model.length > 0) model.default = input.model
      obj.model = model
    }
    return { [this.configPath]: stringifyYaml(obj) }
  }

  renderClear(current: FileBundle, profileId: string): FileBundle {
    const raw = current[this.configPath] ?? null
    if (raw === null) return {}
    const obj = parseYamlObject(raw, this.configPath)
    const name = hermesProviderName(profileId)

    if (Array.isArray(obj.custom_providers)) {
      obj.custom_providers = obj.custom_providers.filter((e) => !(isObject(e) && e.name === name))
    }
    // 仅当默认指针指向本档时清除(不动他档/用户设定)。
    if (isObject(obj.model) && obj.model.provider === name) {
      const model = { ...obj.model }
      delete model.provider
      delete model.default
      obj.model = model
    }
    return { [this.configPath]: stringifyYaml(obj) }
  }
}
