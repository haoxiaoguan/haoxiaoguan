// IR 流事件 → Responses 语义 SSE（真流式：边收边发，不缓冲整段）。id 由 opts 注入。
// 帧序：response.created → response.in_progress（**立即发**，先于上游首事件，避免慢/推理上游的长 TTFT
//   让客户端在"首事件超时"前收不到任何字节而断连）
//   → 文本块：output_item.added(message) / content_part.added / output_text.delta… / content_part.done / output_item.done
//   → 工具块：output_item.added(function_call) / function_call_arguments.delta… / output_item.done
//   → response.completed → `data: [DONE]`
// 上游静默期（如 reasoning 思考阶段）按 heartbeatMs 发 SSE 注释行（`:` 开头，规范要求客户端忽略）保活，
//   防止客户端的"事件间空闲超时"。上游中途出错 → 收尾 response.failed + [DONE]（流已 200，无法回退状态码）。
// sequence_number 全局单调递增；output_index 按落地的输出项递增。
// bytecode 安全：纯异步生成器，无 class-property 箭头。
import type { CanonicalStreamEvent } from '../../../domain/canonical'
import type { Usage } from '../../../domain/canonical/canonical-response'
import { customToolInputFromChatArguments } from './responses-types'

export interface ResponsesStreamOpts {
  id: string
  itemId: (index: number) => string
  createdAt: number
  /** 请求模型名（created/completed 帧用；真流式下无预折叠响应可取）。 */
  model: string
  /** 心跳间隔(ms)：>0 时在上游静默期发 SSE 注释保活；0/缺省=关闭（便于单测确定性）。 */
  heartbeatMs?: number
  /** 流正常收尾回调，传入累计的全部事件（供 store 折叠 + 落盘）；上游出错时**不**调用。 */
  onComplete?: (events: CanonicalStreamEvent[]) => void
  /** custom(freeform)工具名集合：命中者把工具调用流式还原为 custom_tool_call(而非 function_call)。 */
  customToolNames?: Set<string>
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

const HEARTBEAT_FRAME = ': keep-alive\n\n'

export async function* serializeResponsesStream(
  events: AsyncIterable<CanonicalStreamEvent>,
  opts: ResponsesStreamOpts,
): AsyncGenerator<string> {
  let seq = 0
  const next = (): number => seq++
  const baseResp = { id: opts.id, object: 'response', created_at: opts.createdAt, status: 'in_progress', model: opts.model, output: [] as unknown[] }

  // **立即**发 created/in_progress（不等上游首事件）——这是修复"长 TTFT 被客户端断连"的关键。
  yield frame('response.created', { type: 'response.created', sequence_number: next(), response: baseResp })
  yield frame('response.in_progress', { type: 'response.in_progress', sequence_number: next(), response: baseResp })

  const collected: CanonicalStreamEvent[] = []
  let outputIndex = 0
  let msgOpen = false
  let msgItemId = ''
  let textBuf = ''
  let toolOpen = false
  let toolItemId = ''
  let toolArgs = ''
  let curToolCallId = ''
  let curToolName = ''
  let curToolIsCustom = false
  let finalUsage: Usage = { inputTokens: 0, outputTokens: 0 }
  const customToolNames = opts.customToolNames

  const openMessage = (): string[] => {
    if (msgOpen) return []
    msgItemId = opts.itemId(outputIndex)
    msgOpen = true
    return [
      frame('response.output_item.added', { type: 'response.output_item.added', sequence_number: next(), output_index: outputIndex, item: { id: msgItemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } }),
      frame('response.content_part.added', { type: 'response.content_part.added', sequence_number: next(), item_id: msgItemId, output_index: outputIndex, content_index: 0, part: { type: 'output_text', text: '' } }),
    ]
  }
  const closeMessage = (): string[] => {
    if (!msgOpen) return []
    const out = [
      frame('response.content_part.done', { type: 'response.content_part.done', sequence_number: next(), item_id: msgItemId, output_index: outputIndex, content_index: 0, part: { type: 'output_text', text: textBuf } }),
      frame('response.output_item.done', { type: 'response.output_item.done', sequence_number: next(), output_index: outputIndex, item: { id: msgItemId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: textBuf }] } }),
    ]
    msgOpen = false
    textBuf = ''
    outputIndex++
    return out
  }
  const closeTool = (): string[] => {
    if (!toolOpen) return []
    toolOpen = false
    const out: string[] = []
    if (curToolIsCustom) {
      // custom(freeform)工具：从累积的 {"input":...} arguments 取出 freeform 文本，一次性发 input.delta+done
      //（freeform 文本嵌在 JSON 字段里，无法按 SSE 增量切；累积后整发，对齐参考实现）。
      const input = customToolInputFromChatArguments(toolArgs)
      if (input.length > 0) {
        out.push(frame('response.custom_tool_call_input.delta', { type: 'response.custom_tool_call_input.delta', sequence_number: next(), item_id: toolItemId, output_index: outputIndex, delta: input }))
      }
      out.push(frame('response.custom_tool_call_input.done', { type: 'response.custom_tool_call_input.done', sequence_number: next(), item_id: toolItemId, output_index: outputIndex, input }))
      out.push(frame('response.output_item.done', { type: 'response.output_item.done', sequence_number: next(), output_index: outputIndex, item: { id: toolItemId, type: 'custom_tool_call', status: 'completed', call_id: curToolCallId, name: curToolName, input } }))
    } else {
      out.push(frame('response.output_item.done', { type: 'response.output_item.done', sequence_number: next(), output_index: outputIndex, item: { id: toolItemId, type: 'function_call', status: 'completed', call_id: curToolCallId, name: curToolName, arguments: toolArgs } }))
    }
    toolArgs = ''
    outputIndex++
    return out
  }

  const src = events[Symbol.asyncIterator]()
  try {
    let pending = src.next()
    for (;;) {
      let result: IteratorResult<CanonicalStreamEvent>
      const hbMs = opts.heartbeatMs ?? 0
      if (hbMs > 0) {
        const HB = Symbol('hb')
        let hbTimer: ReturnType<typeof setTimeout> | undefined
        const hbP = new Promise<typeof HB>((resolve) => { hbTimer = setTimeout(() => resolve(HB), hbMs) })
        let winner: IteratorResult<CanonicalStreamEvent> | typeof HB
        try {
          winner = await Promise.race([pending, hbP])
        } finally {
          if (hbTimer !== undefined) clearTimeout(hbTimer)
        }
        if (winner === HB) {
          yield HEARTBEAT_FRAME // 上游仍在思考/未出首字节 —— 发心跳保活，pending 继续等待
          continue
        }
        result = winner
      } else {
        result = await pending
      }
      if (result.done) break
      const ev = result.value
      collected.push(ev)
      if (ev.type === 'text_delta') {
        yield* closeTool()
        yield* openMessage()
        textBuf += ev.text
        yield frame('response.output_text.delta', { type: 'response.output_text.delta', sequence_number: next(), item_id: msgItemId, output_index: outputIndex, content_index: 0, delta: ev.text })
      } else if (ev.type === 'thinking_delta') {
        // reasoning 文本非 Responses 输出目标，丢弃（但其到达本身已经过 for 循环 → 不算静默，无需额外心跳）。
      } else if (ev.type === 'tool_use_start') {
        yield* closeMessage()
        yield* closeTool()
        toolItemId = opts.itemId(outputIndex)
        curToolCallId = ev.id
        curToolName = ev.name
        toolArgs = ''
        toolOpen = true
        curToolIsCustom = customToolNames?.has(ev.name) ?? false
        if (curToolIsCustom) {
          yield frame('response.output_item.added', { type: 'response.output_item.added', sequence_number: next(), output_index: outputIndex, item: { id: toolItemId, type: 'custom_tool_call', status: 'in_progress', call_id: ev.id, name: ev.name, input: '' } })
        } else {
          yield frame('response.output_item.added', { type: 'response.output_item.added', sequence_number: next(), output_index: outputIndex, item: { id: toolItemId, type: 'function_call', status: 'in_progress', call_id: ev.id, name: ev.name, arguments: '' } })
        }
      } else if (ev.type === 'tool_use_delta') {
        if (toolOpen) {
          toolArgs += ev.partialJson
          // custom 工具仅累积(freeform input 在 closeTool 整发)；function 工具逐帧发 arguments delta。
          if (!curToolIsCustom) {
            yield frame('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', sequence_number: next(), item_id: toolItemId, output_index: outputIndex, delta: ev.partialJson })
          }
        }
      } else if (ev.type === 'usage') {
        finalUsage = ev.usage
      }
      pending = src.next()
    }
    yield* closeMessage()
    yield* closeTool()
    // input_tokens 为总输入（含 cache 读写）；cached_tokens 仅命中读取部分（对齐 Responses/OpenAI 语义）。
    const completedInputTotal = finalUsage.inputTokens + (finalUsage.cacheReadTokens ?? 0) + (finalUsage.cacheWriteTokens ?? 0)
    yield frame('response.completed', {
      type: 'response.completed',
      sequence_number: next(),
      response: {
        id: opts.id, object: 'response', created_at: opts.createdAt, status: 'completed', model: opts.model,
        usage: { input_tokens: completedInputTotal, output_tokens: finalUsage.outputTokens, total_tokens: completedInputTotal + finalUsage.outputTokens, ...(finalUsage.cacheReadTokens !== undefined ? { input_tokens_details: { cached_tokens: finalUsage.cacheReadTokens } } : {}) },
      },
    })
    yield 'data: [DONE]\n\n'
    opts.onComplete?.(collected) // 仅成功收尾才折叠落盘
  } catch (err) {
    // 上游中途出错：流已 200、无法改状态码 → 以 Responses 失败事件收尾（关闭已开块，保持帧序合法）。
    yield* closeMessage()
    yield* closeTool()
    yield frame('response.failed', {
      type: 'response.failed',
      sequence_number: next(),
      response: {
        id: opts.id, object: 'response', created_at: opts.createdAt, status: 'failed', model: opts.model,
        error: { message: err instanceof Error ? err.message : String(err) },
      },
    })
    yield 'data: [DONE]\n\n'
  } finally {
    // 客户端断连/取消或出错时，回收上游 reader 锁。
    if (typeof src.return === 'function') {
      try { await src.return(undefined) } catch { /* ignore */ }
    }
  }
}
