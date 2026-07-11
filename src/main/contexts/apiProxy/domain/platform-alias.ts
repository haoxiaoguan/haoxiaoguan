// 平台别名（模型名前缀路由）。
//
// 反代不再按 URL 平台前缀（/{platform}/v1..）锁池——一律裸 /v1.. 入口，按「模型名」分流。
// 客户端可在 model 字段加可选前缀 `<alias>/<realModel>` 显式选定账号池/平台：
//   - 友好别名：kiro→kr（如 `kr/claude-sonnet-4.5`）、codex-native→cx；
//   - 动态平台（relay-<id> 等）无友好别名，用平台名本身作前缀（见 makePlatformAliasResolver 兜底）。
// 解析时剥离前缀、把真实模型名透传上游；不带前缀则按模型名感知路由（findPlatformsForModel）。
// 别名是**可选消歧手段**，不是强制：`claude-sonnet-4.5` 与 `kr/claude-sonnet-4.5` 都能命中 kiro
// （前者要求无同名模型的其它平台抢注，后者无歧义）。

/** 固定平台的友好别名表（唯一真源）。动态平台不在此列。 */
export const PLATFORM_ALIASES: ReadonlyArray<{ platform: string; alias: string }> = [
  { platform: 'kiro', alias: 'kr' },
  { platform: 'codex-native', alias: 'cx' },
  { platform: 'cursor', alias: 'cu' },
]

/** alias → platform（如 kr → kiro）。 */
export const PLATFORM_ALIAS_TO_NAME: ReadonlyMap<string, string> = new Map(
  PLATFORM_ALIASES.map((e) => [e.alias, e.platform]),
)

/** platform → alias（如 kiro → kr）。供 /v1/models 给模型 id 加前缀展示「可路由名」。 */
export const PLATFORM_NAME_TO_ALIAS: ReadonlyMap<string, string> = new Map(
  PLATFORM_ALIASES.map((e) => [e.platform, e.alias]),
)

/**
 * 构造别名解析器：把 model 前缀段解析为已注册平台名。
 * - 命中友好别名（kr/cx）且对应平台已注册 → 返回平台名；
 * - 否则若前缀本身就是已注册平台名（如 relay-<id>、kiro、echo）→ 返回该平台名（平台名即前缀）；
 * - 都不是 → undefined（前缀不剥离，model 原样按模型名路由，兼容含 '/' 的第三方模型名如 anthropic/claude-x）。
 * hasPlatform 通常闭包到实时注册表（registry.get(name) !== undefined），从而支持 relay 热重载。
 */
export function makePlatformAliasResolver(
  hasPlatform: (name: string) => boolean,
): (prefix: string) => string | undefined {
  return (prefix) => {
    const mapped = PLATFORM_ALIAS_TO_NAME.get(prefix)
    if (mapped !== undefined) return hasPlatform(mapped) ? mapped : undefined
    return hasPlatform(prefix) ? prefix : undefined
  }
}
