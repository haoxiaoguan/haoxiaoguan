// Hermes 写入器（additive 模式，多供应商共存）。
// 配置：~/.hermes/config.yaml 顶层 custom_providers[]（snake_case 字段，按 name upsert）——每档独立一项共存。
// 默认指针是顶层独立 model: 段（model.default=<modelId>, model.provider=<name>）。
// 不变式：只动本档 provider 项与（指向本档时的）默认指针,保留用户其余 provider/段。
import { ClientConfigCorruptError } from '../../domain/client-writer'
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseYamlObject, stringifyYaml } from '../hermes-yaml'

/** 本档在 custom_providers 中的 name（稳定、可识别为号小管所写）。 */
export function hermesProviderName(profileId: string): string {
  return `hxg-${profileId}`
}

function isObject(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** custom_providers 必须是序列:缺省→[];已存在但非数组→视为结构异常拒写(不静默丢用户内容)。 */
function requireProviderList(v: unknown, file: string): unknown[] {
  if (v === undefined || v === null) return []
  if (!Array.isArray(v)) {
    throw new ClientConfigCorruptError(file, `Hermes config.yaml 的 custom_providers 不是序列，拒绝写入：${file}`)
  }
  return v
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

    // 原位 upsert:命中同名就地替换(保持顺序,减少 diff 噪声),否则追加。
    const list = requireProviderList(obj.custom_providers, this.configPath)
    const idx = list.findIndex((e) => isObject(e) && e.name === name)
    if (idx >= 0) list[idx] = element
    else list.push(element)
    obj.custom_providers = list

    if (input.isDefault === true) {
      const model = isObject(obj.model) ? { ...obj.model } : {}
      model.provider = name
      // 有模型才设 default;无模型时清除残留 default,避免 provider→本档、default→他档模型的脏指针。
      if (input.model !== undefined && input.model.length > 0) model.default = input.model
      else delete model.default
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
