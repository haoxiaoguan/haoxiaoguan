// Gemini CLI 写入器（switch 模式，双文件）。
// ~/.gemini/.env：行级合并 GOOGLE_GEMINI_BASE_URL / GEMINI_API_KEY / GEMINI_MODEL（保留其余行）。
// ~/.gemini/settings.json：键级合并 security.auth.selectedType='gemini-api-key'（API key 模式），保留其余键。
import type { ClientConfigWriter, ApplyInput, FileBundle } from '../../domain/client-writer'
import { parseJsonObject, stringifyJson, isObject, upsertEnvLines, removeEnvKeys } from '../config-text'

const ENV_KEYS = ['GOOGLE_GEMINI_BASE_URL', 'GEMINI_API_KEY', 'GEMINI_MODEL']

export class GeminiWriter implements ClientConfigWriter {
  readonly clientId = 'gemini_cli' as const
  readonly writeMode = 'switch' as const
  private readonly envPath: string
  private readonly settingsPath: string

  constructor(envPath: string, settingsPath: string) {
    this.envPath = envPath
    this.settingsPath = settingsPath
  }

  configFiles(): string[] {
    return [this.envPath, this.settingsPath]
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    const env = upsertEnvLines(current[this.envPath] ?? null, {
      GOOGLE_GEMINI_BASE_URL: input.baseUrl,
      GEMINI_API_KEY: input.apiKey,
      ...(input.model !== undefined && input.model.length > 0 ? { GEMINI_MODEL: input.model } : {}),
    })
    const settings = parseJsonObject(current[this.settingsPath] ?? null, this.settingsPath)
    const security = isObject(settings.security) ? { ...settings.security } : {}
    const auth = isObject(security.auth) ? { ...security.auth } : {}
    auth.selectedType = 'gemini-api-key'
    security.auth = auth
    settings.security = security
    return {
      [this.envPath]: env,
      [this.settingsPath]: stringifyJson(settings),
    }
  }

  renderClear(current: FileBundle, _profileId: string): FileBundle {
    // 仅清 .env 里我们写的键；settings.json 的 auth 模式保守保留（不擅自切回 oauth，避免打断用户）。
    return { [this.envPath]: removeEnvKeys(current[this.envPath] ?? null, ENV_KEYS) }
  }
}
