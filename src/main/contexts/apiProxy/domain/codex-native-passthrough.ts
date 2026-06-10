// 原生（ChatGPT OAuth）透传端口契约。放在 domain 层，使 application（ApiProxyService）
// 依赖此抽象、infrastructure 适配器实现它，避免基础设施反向依赖 application。
//
// 与其它适配器（IR 进 / IR 出）不同：原生路是 HTTP 级**原始 Responses 透传** ——
// Codex 与 ChatGPT 后端说同一个 Responses 协议，不转 IR、不动 store，最大保真
// （保留 reasoning / 工具 / store 语义）。

/** 透传输入：原样转发的 Responses 请求体 + 入站请求头（用于保真转发）。 */
export interface CodexNativeProxyInput {
  body: unknown
  requestId: string
  stream: boolean
  signal?: AbortSignal
  /** 入站请求头（小写键）；除鉴权外原样转发到上游。 */
  headers?: Record<string, string>
}

/** 透传结果：stream 存在则为 SSE 文本帧流，否则用 body 作非流式 JSON。 */
export interface CodexNativeResult {
  status: number
  stream?: AsyncIterable<string>
  body?: unknown
}

/** 原生透传端口：判模型归属 + 执行透传。 */
export interface CodexNativePassthrough {
  /** 该模型是否归原生（ChatGPT 登录账号）所有。 */
  isNativeModel(model: string | undefined): boolean
  /** 把 Responses 请求透传到 ChatGPT 后端并返回（流式/非流式）。 */
  proxyResponses(input: CodexNativeProxyInput): Promise<CodexNativeResult>
}
