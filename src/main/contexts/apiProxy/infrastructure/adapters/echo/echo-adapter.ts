// EchoUpstreamAdapter：纯确定性占位上游，是 M3 KiroAdapter 的 stand-in。
// 行为：把请求里「最后一条 user 消息的文本」回显为 assistant 文本；固定 usage；stopReason='end_turn'。
// 流式：把回显文本按「单一 text_delta」吐出（保持确定性，不做分词），再发 usage + message_stop。
// 严禁 Date.now()/Math.random()/crypto.randomUUID()——保证可单测；需要的 id 由 ctx.requestId 注入。
import type {
  PlatformUpstreamAdapter,
  UpstreamCtx,
  ModelInfo,
  ErrorClass,
} from '../../../domain/platform-adapter'
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
} from '../../../domain/canonical'

const ECHO_MODELS: ModelInfo[] = [
  { id: 'echo-1', displayName: 'Echo One' },
  { id: 'echo-mini', displayName: 'Echo Mini' },
]

// 固定 usage（确定性）。输入计数粗略按回显文本长度，输出按回显长度——足够端到端断言用，不追求真实分词。
function echoUsage(text: string): { inputTokens: number; outputTokens: number } {
  const n = text.length
  return { inputTokens: n, outputTokens: n }
}

// 取最后一条 user 消息里所有 text 块拼接（'\n' 连）；无则空串。
function lastUserText(ir: CanonicalRequest): string {
  for (let i = ir.messages.length - 1; i >= 0; i--) {
    const msg = ir.messages[i]
    if (msg.role !== 'user') continue
    const texts = msg.content
      .filter((b: ContentBlock): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
    if (texts.length > 0) return texts.join('\n')
    // 该 user 消息无文本（可能是 tool_result）→ 继续往前找上一条 user。
  }
  return ''
}

export class EchoUpstreamAdapter implements PlatformUpstreamAdapter {
  readonly platform = 'echo'

  supportsModel(model: string): boolean {
    return model === 'echo' || model.startsWith('echo-')
  }

  classifyError(): ErrorClass {
    return 'FATAL' // Echo 无重试语义
  }

  listModels(): ModelInfo[] {
    return ECHO_MODELS.map((m) => ({ ...m }))
  }

  async chat(ir: CanonicalRequest, _ctx: UpstreamCtx): Promise<CanonicalResponse> {
    const text = lastUserText(ir)
    return {
      model: ir.model,
      content: [{ type: 'text', text }],
      stopReason: 'end_turn',
      usage: echoUsage(text),
    }
  }

  async *chatStream(ir: CanonicalRequest, _ctx: UpstreamCtx): AsyncIterable<CanonicalStreamEvent> {
    const text = lastUserText(ir)
    // 确定性单片 text_delta（不分词）；空文本时也发一个空 delta 以保证至少一段内容。
    yield { type: 'text_delta', text }
    yield { type: 'usage', usage: echoUsage(text) }
    yield { type: 'message_stop', stopReason: 'end_turn' }
  }
}
