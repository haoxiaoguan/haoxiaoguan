// Claude Desktop 写入器（switch 模式）。
// 对齐 cc-switch 的最小 3P 配置：普通/3P config 切到 deploymentMode=3p，
// 并在 Claude-3p/configLibrary 写入固定号小管 profile 与 _meta.json。
import { dirname, join } from 'node:path'
import type { ApplyInput, ClientConfigWriter, FileBundle } from '../../domain/client-writer'
import { isObject, parseJsonObject, stringifyJson } from '../config-text'

export const CLAUDE_DESKTOP_PROFILE_ID = '00000000-0000-4000-8000-000000157210'
const CLAUDE_DESKTOP_PROFILE_NAME = '号小管'

interface TierModel {
  model?: string | undefined
  name?: string | undefined
  supports1m?: boolean | undefined
}

function writeDeployment(raw: string | null, path: string, mode: '1p' | '3p'): Record<string, unknown> {
  const obj = parseJsonObject(raw, path)
  obj.deploymentMode = mode
  return obj
}

function readModelMap(settings: Record<string, unknown> | undefined): TierModel[] {
  const raw = settings?.modelMap
  if (!isObject(raw)) return []
  const out: TierModel[] = []
  for (const tier of ['sonnet', 'opus', 'haiku'] as const) {
    const v = raw[tier]
    if (typeof v === 'string' && v.length > 0) {
      out.push({ model: v })
    } else if (isObject(v)) {
      const model = typeof v.model === 'string' && v.model.length > 0 ? v.model : undefined
      const name = typeof v.name === 'string' && v.name.length > 0 ? v.name : undefined
      const supports1m = v.supports1m === true
      if (model !== undefined) out.push({ model, name, supports1m })
    }
  }
  return out
}

function isDesktopSafeModelId(model: string): boolean {
  const normalized = model.startsWith('anthropic/') ? model.slice('anthropic/'.length) : model
  const tail = normalized.startsWith('claude-') ? normalized.slice('claude-'.length) : ''
  return ['sonnet-', 'opus-', 'haiku-', 'fable-'].some((prefix) => {
    const rest = tail.startsWith(prefix) ? tail.slice(prefix.length) : ''
    return rest.length > 0
  })
}

function inferenceModelJson(model: TierModel): string | Record<string, unknown> | undefined {
  if (model.model === undefined || !isDesktopSafeModelId(model.model)) return undefined
  const item: Record<string, unknown> = { name: model.model }
  if (model.name !== undefined) item.labelOverride = model.name
  if (model.supports1m === true) item.supports1m = true
  return Object.keys(item).length === 1 ? model.model : item
}

function buildProfile(input: ApplyInput): Record<string, unknown> {
  const profile: Record<string, unknown> = {
    coworkEgressAllowedHosts: ['*'],
    disableDeploymentModeChooser: true,
    inferenceGatewayApiKey: input.apiKey,
    inferenceGatewayAuthScheme: 'bearer',
    inferenceGatewayBaseUrl: input.baseUrl,
    inferenceProvider: 'gateway',
  }
  const models = readModelMap(input.settings).map(inferenceModelJson).filter((v): v is string | Record<string, unknown> => v !== undefined)
  if (models.length === 0 && input.model !== undefined && input.model.length > 0) {
    models.push(input.model)
  }
  if (models.length > 0) profile.inferenceModels = models
  return profile
}

function writeMeta(raw: string | null, path: string, applied: boolean): Record<string, unknown> {
  const obj = parseJsonObject(raw, path)
  const rawEntries = Array.isArray(obj.entries) ? obj.entries : []
  const entries = rawEntries.filter((entry) => {
    return !isObject(entry) || entry.id !== CLAUDE_DESKTOP_PROFILE_ID
  })
  if (applied) {
    entries.push({ id: CLAUDE_DESKTOP_PROFILE_ID, name: CLAUDE_DESKTOP_PROFILE_NAME })
    obj.appliedId = CLAUDE_DESKTOP_PROFILE_ID
  } else {
    if (obj.appliedId === CLAUDE_DESKTOP_PROFILE_ID) {
      const next = entries.find((entry) => isObject(entry) && typeof entry.id === 'string') as Record<string, unknown> | undefined
      if (typeof next?.id === 'string') obj.appliedId = next.id
      else delete obj.appliedId
    }
  }
  obj.entries = entries
  return obj
}

function removeEnterpriseConfig(raw: string | null, path: string): Record<string, unknown> {
  const obj = writeDeployment(raw, path, '1p')
  if (isObject(obj.enterpriseConfig)) {
    const enterprise = { ...obj.enterpriseConfig }
    for (const key of [
      'disableDeploymentModeChooser',
      'inferenceGatewayApiKey',
      'inferenceGatewayAuthScheme',
      'inferenceGatewayBaseUrl',
      'inferenceProvider',
    ]) {
      delete enterprise[key]
    }
    if (Object.keys(enterprise).length > 0) obj.enterpriseConfig = enterprise
    else delete obj.enterpriseConfig
  }
  return obj
}

export class ClaudeDesktopWriter implements ClientConfigWriter {
  readonly clientId = 'claude_desktop' as const
  readonly writeMode = 'switch' as const
  private readonly profilePath: string
  private readonly metaPath: string

  constructor(
    private readonly normalConfigPath: string,
    private readonly threepConfigPath: string,
    profilePath?: string,
    metaPath?: string,
  ) {
    const libraryDir = join(dirname(threepConfigPath), 'configLibrary')
    this.profilePath = profilePath ?? join(libraryDir, `${CLAUDE_DESKTOP_PROFILE_ID}.json`)
    this.metaPath = metaPath ?? join(libraryDir, '_meta.json')
  }

  configFiles(): string[] {
    return [this.normalConfigPath, this.threepConfigPath, this.profilePath, this.metaPath]
  }

  renderApply(current: FileBundle, input: ApplyInput): FileBundle {
    return {
      [this.normalConfigPath]: stringifyJson(writeDeployment(current[this.normalConfigPath] ?? null, this.normalConfigPath, '3p')),
      [this.threepConfigPath]: stringifyJson(writeDeployment(current[this.threepConfigPath] ?? null, this.threepConfigPath, '3p')),
      [this.profilePath]: stringifyJson(buildProfile(input)),
      [this.metaPath]: stringifyJson(writeMeta(current[this.metaPath] ?? null, this.metaPath, true)),
    }
  }

  renderClear(current: FileBundle, _profileId: string): FileBundle {
    return {
      [this.normalConfigPath]: stringifyJson(writeDeployment(current[this.normalConfigPath] ?? null, this.normalConfigPath, '1p')),
      [this.threepConfigPath]: stringifyJson(removeEnterpriseConfig(current[this.threepConfigPath] ?? null, this.threepConfigPath)),
      [this.profilePath]: stringifyJson({}),
      [this.metaPath]: stringifyJson(writeMeta(current[this.metaPath] ?? null, this.metaPath, false)),
    }
  }
}
