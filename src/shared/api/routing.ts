// 客户端接入 / 反代 / 路由组合 / 出站代理 / 账号分组 DTO
// （clientConfig · apiProxy · combo · proxy · accountGroup context）。

// ─── clientConfig DTO（与 main domain 同形）─────────────────────────────────
export type ClientConfigClientId =
  | 'claude'
  | 'codex'
  | 'gemini_cli'
  | 'opencode'
  | 'openclaw'
  | 'hermes'
export type ClientConfigWriteMode = 'switch' | 'additive'
export interface ClientConfigClientInfo {
  clientId: ClientConfigClientId
  displayName: string
  detected: boolean
  writeMode: ClientConfigWriteMode
}
export interface ClientConfigVersionInfo {
  clientId: ClientConfigClientId
  /** 已装版本（CLI `--version` 解析所得；未探到为 undefined）。 */
  installedVersion?: string
  /** 远程最新版（npm/PyPI/GitHub；离线/查不到为 undefined）。 */
  latestVersion?: string
  upgradable: boolean
  /** 升级命令（仅 upgradable 时给出，供 tooltip 展示）。 */
  upgradeCommand?: string
  /** 安装命令（仅未安装时给出，供「复制手动安装命令」）。 */
  installCommand?: string
  /** 定位到 CLI 但 `--version` 报错退出（装了跑不起来）。 */
  installedButBroken: boolean
}
export interface ClientConfigUpgradeResult {
  ok: boolean
  /** 失败时的诊断（命令输出末尾若干行）。 */
  detail?: string
  /** 升级后重新探测到的该客户端版本信息（UI 据此即时刷新徽章）。 */
  version: ClientConfigVersionInfo
}
export interface ClientConfigInstallation {
  path: string
  version?: string
  runnable: boolean
  error?: string
  /** 安装来源：nvm/homebrew/volta/pip/npm/... */
  source: string
  /** 是否为 PATH 默认（命令行实际命中、升级作用目标）。 */
  isPathDefault: boolean
}
export interface ClientConfigInstallReport {
  clientId: ClientConfigClientId
  installs: ClientConfigInstallation[]
  /** ≥2 处且（版本分歧或运行态混合）。 */
  isConflict: boolean
}
export interface ClientConfigProfileDto {
  id: string
  clientId: ClientConfigClientId
  name: string
  source: 'local-proxy' | 'manual'
  baseUrl: string
  model?: string
  settings?: Record<string, unknown>
  isCurrent: boolean
  enabled: boolean
  isDefault: boolean
  sortIndex: number
  createdAt: number
  updatedAt: number
  notes?: string
}
export interface ClientConfigDiffFile {
  file: string
  before: string | null
  after: string | null
}
export interface ClientConfigSnapshotDto {
  id: string
  clientId: ClientConfigClientId
  action: string
  tsMs: number
  profileId?: string
  files: Record<string, string | null>
}
export interface CreateClientConfigProfileDto {
  clientId: ClientConfigClientId
  name: string
  source: 'local-proxy' | 'manual'
  baseUrl: string
  model?: string
  settings?: Record<string, unknown>
  apiKey?: string
  keyRef?: string
  notes?: string
}
export interface UpdateClientConfigProfileDto {
  name?: string
  baseUrl?: string
  model?: string | null
  settings?: Record<string, unknown> | null
  apiKey?: string
  notes?: string | null
}
/** 配置预览草稿入参（表单值,不存档）。 */
export interface ClientConfigDraftInput {
  clientId: ClientConfigClientId
  name: string
  baseUrl: string
  apiKey?: string
  model?: string
  settings?: Record<string, unknown>
}
/** 拉取模型列表入参:apiKey 为空且给 profileId 时由后端解出已存档的 key。 */
export interface ClientConfigFetchModelsInput {
  clientId: ClientConfigClientId
  baseUrl: string
  apiKey?: string
  profileId?: string
  /** 「完整 URL」开关：true=原样用 baseUrl（不补 /v1）；缺省=启发式。与表单一致。 */
  fullUrl?: boolean
}
export interface ClientConfigConnTest {
  ok: boolean
  status?: number
  message?: string
}

export interface WsStatus {
  running: boolean
  port?: number
  connectionCount: number
}

// 单条反代请求日志记录（G3）——与 main 的 ProxyRequestRecord 保持同形。
export interface ProxyRequestRecord {
  seq: number
  tsMs: number
  method: string
  path: string
  format: string
  platform?: string
  action: string
  stream: boolean
  status: number
  ok: boolean
  durationMs: number
  attempts: number
  accountId?: string
  clientKeyId?: string
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  errorMessage?: string
  // ── 路由维度（路由日志分析模块）──
  comboName?: string
  requestedModel?: string
  finalModel?: string
  routeHops?: number
  routePath?: string[]
}

// ── 路由日志分析 DTO（routing-log 模块；与 main domain 的 routing-log-record 同形）────────
/** 查询窗口：epoch 秒闭区间。 */
export interface RoutingWindowDto {
  startSec: number
  endSec: number
}
export type RoutingGranularityDto = 'hour' | 'day'
export type RoutingBreakdownDimDto = 'platform' | 'combo' | 'model' | 'status' | 'account'
export interface RoutingSummaryDto {
  requests: number
  success: number
  failed: number
  successRate: number
  errorRate: number
  avgDurationMs: number
  p95DurationMs: number
  inputTokens: number
  outputTokens: number
  cacheReadTokens: number
  cacheWriteTokens: number
  totalTokens: number
  fallbackRequests: number
  comboRequests: number
  /** 峰值 RPM：窗口内单分钟最高请求数。 */
  peakRpm: number
}
export interface RoutingTrendPointDto {
  date: string
  requests: number
  success: number
  failed: number
  avgDurationMs: number
  inputTokens: number
  outputTokens: number
}
export interface RoutingBreakdownRowDto {
  key: string
  requests: number
  success: number
  failed: number
  successRate: number
  avgDurationMs: number
  inputTokens: number
  outputTokens: number
  shareRatio: number
}
export interface RoutingErrorRowDto {
  message: string
  count: number
  lastStatus: number
  lastTsMs: number
}
export interface RoutingRecentFilterDto {
  okOnly?: boolean
  failedOnly?: boolean
  platform?: string
  comboName?: string
}
export interface RoutingRecentRowDto {
  seq: number
  tsMs: number
  method: string
  path: string
  format: string
  platform?: string
  action: string
  stream: boolean
  status: number
  ok: boolean
  durationMs: number
  attempts: number
  accountId?: string
  clientKeyId?: string
  comboName?: string
  requestedModel?: string
  finalModel?: string
  routeHops?: number
  routePath?: string[]
  inputTokens?: number
  outputTokens?: number
  cacheReadTokens?: number
  cacheWriteTokens?: number
  errorMessage?: string
}

// apiProxy 服务状态（与 main/contexts/apiProxy/application/api-proxy-service.ts
// 的 ApiProxyStatus 保持同形：state + 可选 port）。
export type ApiProxyState = 'stopped' | 'running' | 'failed'
export interface ApiProxyStatus {
  state: ApiProxyState
  port?: number
}

// 自动更新状态（G9）：主进程 autoUpdater 事件投影。
export type UpdateState =
  | 'idle'
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'
export interface UpdateStatus {
  state: UpdateState
  /** 可用 / 已下载的目标版本号。 */
  version?: string
  /** 升级前的当前版本（available 起一并带上，供「a → b」对比展示）。 */
  currentVersion?: string
  /** 发布说明（已规整为纯文本；可能多段），供弹窗展示更新内容。 */
  releaseNotes?: string
  /** 发布名称/标题（部分上游提供）。 */
  releaseName?: string
  /** downloading 时的进度百分比（0–100）。 */
  percent?: number
  /** downloading 时已下载字节数。 */
  transferred?: number
  /** downloading 时总字节数。 */
  total?: number
  /** downloading 时下载速率（字节/秒）。 */
  bytesPerSecond?: number
  /** downloaded 且需手动安装（mac 未签名:已下载 dmg，提示用户拖入 Applications，而非自动重启安装）。 */
  manualInstall?: boolean
  /** error 时的错误信息。 */
  error?: string
}

/**
 * 已接入「反代账号选号」的平台（账号型上游）。其账号才可被加入反代池 / 显示入池开关。
 * 目前仅 Kiro 走 FailoverAdapter 选号链；以后新增账号型上游平台时在此登记即自动纳入。
 */
export const PROXY_POOL_PLATFORMS = ['kiro'] as const
export type ProxyPoolPlatform = (typeof PROXY_POOL_PLATFORMS)[number]
/** 平台是否可入反代池。 */
export function isProxyPoolPlatform(platform: string): boolean {
  return (PROXY_POOL_PLATFORMS as readonly string[]).includes(platform)
}

// 账号池健康行（IPC 返回）：合并账号 meta + 运行态快照 + 入池标识 + 窗口内请求统计。
export interface AccountPoolHealthRow {
  accountId: string
  /** 账号所属平台（agentId，如 'kiro'）；前端展示平台标识/徽章。 */
  platform: string
  email: string
  status?: string
  runtimeState: 'available' | 'cooldown' | 'quota_exhausted' | 'suspended'
  failureCount: number
  cooldownUntilMs?: number
  quotaExhaustedAtMs?: number
  /** quota_exhausted 恢复时间戳（ms）：由服务端按配置值计算，前端直接展示。 */
  quotaResetsAtMs?: number
  /** 是否在反代账号池内（拥有池标识，才会被反代选号）。 */
  pooled: boolean
  /** 选号权重优先级（越大占比越高；未入池为 0）。 */
  priority: number
  /** 每账号并发上限（同时在途请求数；未入池为默认值）。 */
  concurrency: number
  /** 窗口内被请求次数（来自路由日志聚合）。 */
  requests: number
  /** 窗口内成功次数。 */
  success: number
  /** 窗口内失败次数。 */
  failed: number
  /** 窗口内命中 429（限流）的次数。 */
  rateLimited: number
  /** 窗口内平均延迟（ms）。 */
  avgDurationMs: number
  /** 窗口内峰值 RPM（单分钟最高请求数）。 */
  peakRpm: number
  /** 窗口内输入 token 合计。 */
  inputTokens: number
  /** 窗口内输出 token 合计。 */
  outputTokens: number
  /** 窗口内缓存 token 合计（读 + 写）。 */
  cacheTokens: number
  /** 窗口内最近一次被请求时刻（ms；无则 undefined）。 */
  lastRequestMs?: number
}

// 反代池全局选号配置（池级；优先级与并发为每账号配置，不在此）。
export interface ApiProxySelectionConfigDto {
  /** 轮询策略：会话粘性 LRU / 轮询。 */
  strategy: 'sticky-lru' | 'round-robin'
  /** 亲密度：会话粘性保持时长（ms，0=不粘）。 */
  affinityTtlMs: number
}

// 客户端 Key 元信息（不含明文/密文）。
export interface ApiProxyKeyMeta {
  id: string
  name: string
  keyPrefix: string
  isActive: boolean
  createdAt: string
}

// ── 路由组合 DTO（命名的跨供应商降级链）─────────────────────────────────────────
/** 组合的一跳：别名前缀模型串（如 kr/claude-sonnet-4.5）+ 是否启用（缺省启用）。 */
export interface ComboStepDto {
  model: string
  enabled?: boolean
}
export interface RouteComboDto {
  id: string
  name: string
  description?: string
  steps: ComboStepDto[]
  strategy: 'fallback'
  enabled: boolean
}
/** 新建/更新组合入参（id/时间戳由后端生成）。 */
export interface RouteComboInputDto {
  name: string
  description?: string
  steps: ComboStepDto[]
  enabled?: boolean
}

// ── Proxy DTOs (proxy context — outbound proxy IP management) ─────────────────
export type ProxyProtocolDto = 'http' | 'https' | 'socks5'
export type ProxyStatusDto = 'unknown' | 'ok' | 'failed'

/** A proxy as seen by the renderer — never carries the plaintext password. */
export interface ProxyDto {
  id: string
  label?: string | undefined
  protocol: ProxyProtocolDto
  host: string
  port: number
  username?: string | undefined
  passwordSet: boolean
  status: ProxyStatusDto
  lastEgressIp?: string | undefined
  lastLatencyMs?: number | undefined
  lastCheckedAt?: string | undefined
  lastError?: string | undefined
  tags: string[]
  displayUrl: string
  boundAccountCount: number
  createdAt: string
}
export interface AccountBindingDto {
  accountId: string
  proxyId?: string | undefined
}
export interface ProxyImportSummary {
  imported: number
  skipped: number
  failed: Array<{ lineNumber: number; raw: string; error: string }>
}
export interface ProxyTestResultDto {
  proxyId: string
  status: 'ok' | 'failed'
  egressIp?: string | undefined
  latencyMs?: number | undefined
  error?: string | undefined
  checkedAt: string
}
export interface CreateProxyRequest {
  label?: string
  protocol: ProxyProtocolDto
  host: string
  port: number
  username?: string
  password?: string
  tags?: string[]
}
export interface UpdateProxyRequest {
  label?: string
  protocol?: ProxyProtocolDto
  host?: string
  port?: number
  username?: string
  password?: string | null
  tags?: string[]
}

// ── AccountGroup DTOs (account-group context) ────────────────────────────────
export interface AccountGroupBindingDto {
  groupId: string
  proxyId?: string | undefined
}
export interface AccountGroupDto {
  id: string
  name: string
  color?: string | undefined
  description?: string | undefined
  memberCount: number
  proxyBinding?: AccountGroupBindingDto | undefined
  createdAt: string
  updatedAt: string
}
export interface AccountGroupMembershipDto {
  groupId: string
  accountId: string
  createdAt: string
}
export interface CreateAccountGroupRequest {
  name: string
  color?: string
  description?: string
}
export interface UpdateAccountGroupRequest {
  name?: string
  color?: string | null
  description?: string | null
}
