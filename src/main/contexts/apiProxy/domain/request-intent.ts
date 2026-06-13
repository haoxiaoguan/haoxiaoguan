// 路由意图解析（纯函数）。把 HTTP method/path/body 收敛为 RequestIntent，供 ApiProxyService 编排。
// 入口仅裸路由 /v1.. /v1beta..（不再支持 /{platform}/v1.. 平台前缀路由）。平台由**模型名前缀**区分：
// model 形如 `<alias>/<realModel>`（如 kr/claude-sonnet-4.5），命中已注册别名/平台才剥离前缀并锁平台，
// 否则保留整串按模型名感知路由（兼容含 '/' 的第三方模型名）。不认识的 path → 返回 null（调用方 404）。

export type RequestFormat = 'openai' | 'anthropic' | 'gemini' | 'openai-responses'
export type RequestAction = 'chat' | 'messages' | 'generateContent' | 'models' | 'health' | 'responses'

/** 前缀→平台解析器：把 model 前缀段解析为已注册平台名；非别名/平台返回 undefined。 */
export type PlatformAliasResolver = (prefix: string) => string | undefined

export interface RequestIntent {
  /** model 前缀命中已注册别名/平台时填（锁池）；无前缀或前缀非法为 undefined（按模型名路由）。 */
  platform?: string
  format: RequestFormat
  action: RequestAction
  /** chat/messages 取 body.model；generateContent 从 :model 段取。已剥离别名前缀（净化后的真实模型名）。 */
  model?: string
  /** chat/messages 取 body.stream；generateContent 看 action 段是否 streamGenerateContent。 */
  stream: boolean
}

// 从 body 安全取字符串字段。
function bodyString(body: unknown, key: string): string | undefined {
  if (body && typeof body === 'object' && key in (body as Record<string, unknown>)) {
    const v = (body as Record<string, unknown>)[key]
    return typeof v === 'string' ? v : undefined
  }
  return undefined
}

// 从 body 安全取布尔字段（缺省 false）。
function bodyBool(body: unknown, key: string): boolean {
  if (body && typeof body === 'object' && key in (body as Record<string, unknown>)) {
    return (body as Record<string, unknown>)[key] === true
  }
  return false
}

// 去掉 query，按 '/' 切成非空段。
function pathSegments(path: string): string[] {
  const noQuery = path.split('?')[0]
  return noQuery.split('/').filter((s) => s.length > 0)
}

/**
 * 解析 model 的别名前缀：`<prefix>/<rest>` 且 prefix 命中 resolveAlias → { platform, model: rest }；
 * 否则原样返回 { model }（含无 '/'、空前缀、未知前缀的情况——后者整串按模型名路由）。
 * 只切第一个 '/'，故第三方含斜杠的真实模型名（如 anthropic/claude-x）在未知前缀时完整保留。
 */
export function resolveModelAlias(
  model: string | undefined,
  resolveAlias: PlatformAliasResolver,
): { platform?: string; model?: string } {
  if (model === undefined) return {}
  const slash = model.indexOf('/')
  if (slash <= 0) return { model }
  const prefix = model.slice(0, slash)
  const platform = resolveAlias(prefix)
  if (platform === undefined) return { model }
  return { platform, model: model.slice(slash + 1) }
}

/**
 * 创建 parseRequestIntent：resolveAlias 决定哪些 model 前缀被当作平台别名剥离。
 * 返回纯函数 (method, path, body?) => RequestIntent | null。
 */
export function makeRequestIntentParser(
  resolveAlias: PlatformAliasResolver,
): (method: string, path: string, body?: unknown) => RequestIntent | null {
  return (method, path, body) => {
    const segs = pathSegments(path)
    const m = method.toUpperCase()

    // /health
    if (segs.length === 1 && segs[0] === 'health' && m === 'GET') {
      return { format: 'openai', action: 'health', stream: false }
    }

    // /v1beta/...（Gemini）
    if (segs[0] === 'v1beta') {
      // /v1beta/models  (GET 列表)
      if (segs.length === 2 && segs[1] === 'models' && m === 'GET') {
        return { format: 'gemini', action: 'models', stream: false }
      }
      // /v1beta/models/{model}:{action}
      if (segs.length === 3 && segs[1] === 'models' && m === 'POST') {
        const tail = segs[2] // 形如 "gemini-pro:generateContent" 或 "...:streamGenerateContent"
        const colon = tail.lastIndexOf(':')
        if (colon <= 0) return null
        const rawModel = tail.slice(0, colon)
        const act = tail.slice(colon + 1)
        if (act !== 'generateContent' && act !== 'streamGenerateContent') return null
        const { platform, model } = resolveModelAlias(rawModel, resolveAlias)
        return {
          ...(platform ? { platform } : {}),
          format: 'gemini',
          action: 'generateContent',
          ...(model !== undefined ? { model } : {}),
          stream: act === 'streamGenerateContent',
        }
      }
      return null
    }

    // /v1/...（OpenAI / Anthropic）
    if (segs[0] === 'v1') {
      // /v1/models
      if (segs.length === 2 && segs[1] === 'models' && m === 'GET') {
        return { format: 'openai', action: 'models', stream: false }
      }
      // /v1/chat/completions
      if (segs.length === 3 && segs[1] === 'chat' && segs[2] === 'completions' && m === 'POST') {
        const { platform, model } = resolveModelAlias(bodyString(body, 'model'), resolveAlias)
        return {
          ...(platform ? { platform } : {}),
          format: 'openai',
          action: 'chat',
          ...(model !== undefined ? { model } : {}),
          stream: bodyBool(body, 'stream'),
        }
      }
      // /v1/messages
      if (segs.length === 2 && segs[1] === 'messages' && m === 'POST') {
        const { platform, model } = resolveModelAlias(bodyString(body, 'model'), resolveAlias)
        return {
          ...(platform ? { platform } : {}),
          format: 'anthropic',
          action: 'messages',
          ...(model !== undefined ? { model } : {}),
          stream: bodyBool(body, 'stream'),
        }
      }
      // /v1/responses
      if (segs.length === 2 && segs[1] === 'responses' && m === 'POST') {
        const { platform, model } = resolveModelAlias(bodyString(body, 'model'), resolveAlias)
        return {
          ...(platform ? { platform } : {}),
          format: 'openai-responses',
          action: 'responses',
          ...(model !== undefined ? { model } : {}),
          stream: bodyBool(body, 'stream'),
        }
      }
      return null
    }

    return null
  }
}
