// 路由意图解析（纯函数）。把 HTTP method/path/body 收敛为 RequestIntent，供 ApiProxyService 编排。
// 识别两类入口：裸 /v1.. /v1beta..（platform 留空）与 /{platform}/v1.. （首段命中已注册平台名才剥离）。
// 不认识的 path 或未注册的平台前缀 → 返回 null（调用方据此 404；spec §5 明确不回退裸路由）。

export type RequestFormat = 'openai' | 'anthropic' | 'gemini'
export type RequestAction = 'chat' | 'messages' | 'generateContent' | 'models' | 'health'

export interface RequestIntent {
  /** 命中 /{platform}/ 前缀且 platform 已注册时填；裸路由为 undefined。 */
  platform?: string
  format: RequestFormat
  action: RequestAction
  /** chat/messages 取 body.model；generateContent 从 :model 段取。 */
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
 * 创建 parseRequestIntent：knownPlatforms 决定哪些首段被当作平台前缀剥离。
 * 返回纯函数 (method, path, body?) => RequestIntent | null。
 */
export function makeRequestIntentParser(
  knownPlatforms: ReadonlySet<string>,
): (method: string, path: string, body?: unknown) => RequestIntent | null {
  return (method, path, body) => {
    let segs = pathSegments(path)
    let platform: string | undefined

    // 平台前缀剥离：首段命中已注册平台名才剥离；若首段看起来像平台前缀（即不是 v1/v1beta/health）
    // 但不在 knownPlatforms → 视为未知平台，返回 null（404）。
    if (segs.length > 0) {
      const head = segs[0]
      const isApiRoot = head === 'v1' || head === 'v1beta' || head === 'health'
      if (!isApiRoot) {
        if (knownPlatforms.has(head)) {
          platform = head
          segs = segs.slice(1)
        } else {
          return null // 未知平台前缀 → 404
        }
      }
    }

    const m = method.toUpperCase()

    // /health
    if (segs.length === 1 && segs[0] === 'health' && m === 'GET') {
      return { ...(platform ? { platform } : {}), format: 'openai', action: 'health', stream: false }
    }

    // /v1beta/...（Gemini）
    if (segs[0] === 'v1beta') {
      // /v1beta/models  (GET 列表)
      if (segs.length === 2 && segs[1] === 'models' && m === 'GET') {
        return { ...(platform ? { platform } : {}), format: 'gemini', action: 'models', stream: false }
      }
      // /v1beta/models/{model}:{action}
      if (segs.length === 3 && segs[1] === 'models' && m === 'POST') {
        const tail = segs[2] // 形如 "gemini-pro:generateContent" 或 "...:streamGenerateContent"
        const colon = tail.lastIndexOf(':')
        if (colon <= 0) return null
        const model = tail.slice(0, colon)
        const act = tail.slice(colon + 1)
        if (act !== 'generateContent' && act !== 'streamGenerateContent') return null
        return {
          ...(platform ? { platform } : {}),
          format: 'gemini',
          action: 'generateContent',
          model,
          stream: act === 'streamGenerateContent',
        }
      }
      return null
    }

    // /v1/...（OpenAI / Anthropic）
    if (segs[0] === 'v1') {
      // /v1/models
      if (segs.length === 2 && segs[1] === 'models' && m === 'GET') {
        return { ...(platform ? { platform } : {}), format: 'openai', action: 'models', stream: false }
      }
      // /v1/chat/completions
      if (segs.length === 3 && segs[1] === 'chat' && segs[2] === 'completions' && m === 'POST') {
        return {
          ...(platform ? { platform } : {}),
          format: 'openai',
          action: 'chat',
          ...(bodyString(body, 'model') !== undefined ? { model: bodyString(body, 'model') } : {}),
          stream: bodyBool(body, 'stream'),
        }
      }
      // /v1/messages
      if (segs.length === 2 && segs[1] === 'messages' && m === 'POST') {
        return {
          ...(platform ? { platform } : {}),
          format: 'anthropic',
          action: 'messages',
          ...(bodyString(body, 'model') !== undefined ? { model: bodyString(body, 'model') } : {}),
          stream: bodyBool(body, 'stream'),
        }
      }
      return null
    }

    return null
  }
}
