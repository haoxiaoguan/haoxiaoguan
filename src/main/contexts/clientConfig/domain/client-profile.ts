// 客户端接入档（provider profile）领域类型。
// 一个客户端可存多份接入档，标记一份「当前生效」；切换=把选中那份按客户端格式写进真实配置文件。

/** 已支持的客户端 id（与 agents/ 的 AgentId 对齐，便于复用 path-resolver 与适配器注册表）。 */
export type ClientId = 'claude' | 'codex' | 'gemini_cli' | 'opencode' | 'openclaw' | 'hermes'

export const CLIENT_IDS: readonly ClientId[] = [
  'claude',
  'codex',
  'gemini_cli',
  'opencode',
  'openclaw',
  'hermes',
]

export const CLIENT_DISPLAY_NAMES: Record<ClientId, string> = {
  claude: 'Claude Code',
  codex: 'Codex',
  gemini_cli: 'Gemini CLI',
  opencode: 'OpenCode',
  openclaw: 'OpenClaw',
  hermes: 'Hermes',
}

/** 某客户端的可用性摘要（供 UI 左侧列表显示）。 */
export interface ClientInfo {
  clientId: ClientId
  displayName: string
  /** 是否检测到该客户端（任一配置文件已存在）。 */
  detected: boolean
  /** 写入语义（决定右侧列表是「当前生效」单选还是「共存」多选）。 */
  writeMode: WriteMode
}

/**
 * 接入档来源：
 * - 'local-proxy'：指向本机反代（http://127.0.0.1:<port>），需要走代理/账号池/IP 的流量经现有 api 路由出站；
 *   反代端口变化或 key 轮换时可一键重写。
 * - 'manual'：用户手填的第三方 base_url（客户端直连，不经号小管）。
 */
export type ProfileSource = 'local-proxy' | 'manual'

/**
 * 写入语义（决定切换时怎么落盘）：
 * - 'switch'：同一配置文件同时只体现「当前生效」那份（Claude / Codex / Gemini）。切换=覆盖写当前档。
 * - 'additive'：多份 provider 共存于同一文件（OpenCode / OpenClaw / Hermes）。切换只改顶层「默认指针」。
 */
export type WriteMode = 'switch' | 'additive'

/** 客户端 → 写入语义。切换式同时仅一份生效;累加式多份共存。
 *  Codex 为累加式:config.toml 可注入多段 model_providers + profiles 共存,顶层 model_provider 为默认。 */
export const CLIENT_WRITE_MODE: Record<ClientId, WriteMode> = {
  claude: 'switch',
  codex: 'additive',
  gemini_cli: 'switch',
  opencode: 'additive',
  openclaw: 'additive',
  hermes: 'additive',
}

/** 一份接入档的对外摘要（不含密文 key —— key 经 safeStorage 加密或指向反代 key 表）。 */
export interface ClientConfigProfile {
  id: string
  clientId: ClientId
  name: string
  source: ProfileSource
  baseUrl: string
  /** 选定模型（写进客户端配置的 model 字段）。 */
  model?: string
  /** 客户端专属配置（per-client 表单的额外字段，如 codex.wireApi / opencode.npm /
   *  openclaw.api / hermes.apiMode）。写入器按客户端读取,缺省用各自默认值。 */
  settings?: Record<string, unknown>
  /** 切换式:是否当前生效（每客户端至多一份）。累加式忽略。 */
  isCurrent: boolean
  /** 累加式:是否已注入 live（多份可同时为 true）。切换式忽略。 */
  enabled: boolean
  /** 累加式:是否默认指针（每客户端至多一份）。切换式忽略。 */
  isDefault: boolean
  sortIndex: number
  createdAt: number
  updatedAt: number
  notes?: string
}
