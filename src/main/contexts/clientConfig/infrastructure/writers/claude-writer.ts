// Claude Code 写入器（switch 模式，JSON 键级合并）。
// 配置：~/.claude/settings.json 的 env 子对象——只动 ANTHROPIC_BASE_URL/AUTH_TOKEN/MODEL，
// 保留用户其余 env 与顶层键。Claude Code 热生效、无需重启。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseJsonObject, stringifyJson, isObject } from '../config-text'

const KEYS = ['ANTHROPIC_BASE_URL', 'ANTHROPIC_AUTH_TOKEN', 'ANTHROPIC_MODEL'] as const

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
