// RelayAdapter：第三方中转平台上游适配器（协议无关，通过注入 codec 支持多协议）。
// implements PlatformUpstreamAdapter；依赖注入 RelayUpstreamClient（测试可替换）。
// 出站代理：runWithDispatcher(ctx.dispatcher, ...) 包住 client 调用（对齐 kiro-adapter）。
// chatStream：在 dispatcher context 内完成 fetch 发起，返回的 generator 在 context 外消费。
// bytecode 安全：无 class-property 箭头初始化，纯方法。
// 禁：Date.now/Math.random/crypto.randomUUID（确定性）；禁动态 import()。
import { runWithDispatcher } from '../../../../../platform/net/dispatcher-context'
import { RelayUpstreamClient, RelayHttpError } from './relay-upstream-client'
import type { RelayOutboundCodec } from './relay-codec'
import type { PlatformUpstreamAdapter, UpstreamCtx, ModelInfo, ErrorClass } from '../../../domain/platform-adapter'
import type { CanonicalRequest, CanonicalResponse, CanonicalStreamEvent } from '../../../domain/canonical'

/** RelayAdapter 构造注入选项。 */
export interface RelayAdapterOpts {
  /** 平台标识（唯一，用于注册表 key + 路由）。 */
  platform: string
  /** 上游协议编解码器（注入不同 codec 支持多协议：openai / anthropic / gemini …）。 */
  codec: RelayOutboundCodec
  /** 上游 base URL，如 'https://api.deepseek.com/v1'。末尾斜杠自动处理。 */
  baseUrl: string
  /** 上游 API Key。 */
  apiKey: string
  /** 该平台对外暴露的模型列表。 */
  models: ModelInfo[]
  /** 传输层客户端（测试可注入假实现）。 */
  client: RelayUpstreamClient
}

/**
 * 拼接 baseUrl + path，安全处理末尾斜杠。
 * joinUrl('https://api.x.com/v1', '/chat/completions') → 'https://api.x.com/v1/chat/completions'
 * joinUrl('https://api.x.com/v1/', '/chat/completions') → 'https://api.x.com/v1/chat/completions'
 */
function joinUrl(base: string, path: string): string {
  return base.replace(/\/+$/, '') + '/' + path.replace(/^\/+/, '')
}

export class RelayAdapter implements PlatformUpstreamAdapter {
  readonly platform: string
  private readonly opts: RelayAdapterOpts

  constructor(opts: RelayAdapterOpts) {
    this.platform = opts.platform
    this.opts = opts
  }

  supportsModel(model: string): boolean {
    return this.opts.models.some((m) => m.id === model)
  }

  listModels(): ModelInfo[] {
    return this.opts.models.map((m) => ({ ...m }))
  }

  /** 把上游错误归类（RelayHttpError.status → ErrorClass）。 */
  classifyError(err: unknown): ErrorClass {
    const e = err as { name?: string; status?: number } | null
    if (e?.name === 'RelayHttpError') {
      const s = e.status
      if (s === 402) return 'QUOTA' // 额度耗尽：冷却到配额重置时间
      if (s === 429) return 'RATE_LIMIT'
      if (s === 401 || s === 403) return 'AUTH'
      if (s === 400 || s === 422) return 'FATAL'
      if (typeof s === 'number' && s >= 500) return 'SERVER'
    }
    // 网络异常 / 超时 / 未知 → SERVER
    return 'SERVER'
  }

  async chat(ir: CanonicalRequest, ctx: UpstreamCtx): Promise<CanonicalResponse> {
    const { client, apiKey, baseUrl, codec } = this.opts
    const outReq = codec.renderRequest(ir, false)
    const headers = codec.authHeaders(apiKey)
    const url = joinUrl(baseUrl, codec.endpointPath(ir, false))

    const resp = await runWithDispatcher(ctx.dispatcher, () =>
      client.post(url, headers, outReq),
    )

    const raw = await resp.json()
    return codec.parseResponse(raw)
  }

  chatStream(ir: CanonicalRequest, ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    // 在 dispatcher context 内完成 fetch 发起（openStream），generator 在 context 外消费。
    const self = this
    async function* gen(): AsyncIterable<CanonicalStreamEvent> {
      const { client, apiKey, baseUrl, codec } = self.opts
      const outReq = codec.renderRequest(ir, true)
      const headers = codec.authHeaders(apiKey)
      const url = joinUrl(baseUrl, codec.endpointPath(ir, true))

      // 在 dispatcher context 内发起 fetch，拿到 chunks（body 已绑 dispatcher）。
      const streamResp = await runWithDispatcher(ctx.dispatcher, () =>
        client.postStream(url, headers, outReq),
      )

      // 在 context 外消费 chunks（undici body 已绑 dispatcher，无需再持有 context）。
      const parser = codec.createStreamParser()
      for await (const chunk of streamResp.chunks()) {
        for (const ev of parser.push(chunk)) {
          yield ev
        }
      }
      for (const ev of parser.flush()) {
        yield ev
      }
    }

    return gen()
  }
}
