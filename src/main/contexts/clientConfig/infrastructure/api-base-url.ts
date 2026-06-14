// API 基地址解析（唯一权威）。
// 同一份 profile.baseUrl 会被多处消费：测连通(GET .../models)、拉模型列表(.../models)、
// 中转 relay 上游(.../responses 或 .../chat/completions)、Codex 直注 config.toml(Codex 自身 POST .../responses)。
// 历史上这几处各自拼 /v1，规则不一致 → 用户填带/不带 /v1 时「测试过了真实却 502」。本函数统一规则：
//
//   fullUrl=false（默认，启发式，向后兼容）：
//     - URL 无路径（空或 '/'） → 补 '/v1'（OpenAI 兼容上游惯例：http://host:8080 → http://host:8080/v1）
//     - URL 已带路径（自建网关 / 已含 /v1） → 原样尊重，不重复补
//   fullUrl=true（用户在表单显式声明「完整 URL」）：
//     - 一律原样使用，绝不补 /v1（适配无 /v1 的自建服务、或路径已完整的网关）
//
// 两种模式都剥尾部斜杠。非法 URL 原样返回（写盘后由各客户端自身报错定位，不在此抛）。
// bytecode 安全：纯函数，无 class-property 箭头。

/** 解析用户填写的 base_url 为规范 API 基地址；调用方在其后接自己的子路径（/models、/responses…）。 */
export function resolveApiBaseUrl(raw: string, fullUrl: boolean): string {
  const trimmed = raw.trim().replace(/\/+$/, '')
  if (fullUrl) return trimmed
  try {
    const u = new URL(trimmed)
    if (u.pathname === '' || u.pathname === '/') return `${trimmed}/v1`
  } catch {
    /* 非 URL 原样返回 */
  }
  return trimmed
}
