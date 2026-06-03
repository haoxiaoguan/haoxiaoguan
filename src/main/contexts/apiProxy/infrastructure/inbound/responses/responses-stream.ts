// IR 流事件 → Responses 语义 SSE。纯函数，id 由 opts 注入。
// 帧序：response.created → response.in_progress
//   → 文本块：output_item.added(message) / content_part.added / output_text.delta… / content_part.done / output_item.done
//   → 工具块：output_item.added(function_call) / function_call_arguments.delta… / output_item.done
//   → response.completed → `data: [DONE]`
// sequence_number 全局单调递增；output_index 按落地的输出项递增。
import type { CanonicalResponse, CanonicalStreamEvent } from '../../../domain/canonical'

export interface ResponsesStreamOpts {
  id: string
  itemId: (index: number) => string
  createdAt: number
}

function frame(event: string, data: unknown): string {
  return `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`
}

export function serializeResponsesStream(
  resp: CanonicalResponse,
  events: CanonicalStreamEvent[],
  opts: ResponsesStreamOpts,
): string[] {
  const frames: string[] = []
  let seq = 0
  const next = (): number => seq++
  const baseResp = { id: opts.id, object: 'response', created_at: opts.createdAt, status: 'in_progress', model: resp.model, output: [] as unknown[] }

  frames.push(frame('response.created', { type: 'response.created', sequence_number: next(), response: baseResp }))
  frames.push(frame('response.in_progress', { type: 'response.in_progress', sequence_number: next(), response: baseResp }))

  let outputIndex = 0
  let msgOpen = false
  let msgItemId = ''
  let textBuf = ''
  let toolOpen = false
  let toolItemId = ''
  let toolArgs = ''
  let curToolCallId = ''
  let curToolName = ''
  let finalUsage = resp.usage

  const openMessage = (): void => {
    if (msgOpen) return
    msgItemId = opts.itemId(outputIndex)
    frames.push(frame('response.output_item.added', { type: 'response.output_item.added', sequence_number: next(), output_index: outputIndex, item: { id: msgItemId, type: 'message', role: 'assistant', status: 'in_progress', content: [] } }))
    frames.push(frame('response.content_part.added', { type: 'response.content_part.added', sequence_number: next(), item_id: msgItemId, output_index: outputIndex, content_index: 0, part: { type: 'output_text', text: '' } }))
    msgOpen = true
  }
  const closeMessage = (): void => {
    if (!msgOpen) return
    frames.push(frame('response.content_part.done', { type: 'response.content_part.done', sequence_number: next(), item_id: msgItemId, output_index: outputIndex, content_index: 0, part: { type: 'output_text', text: textBuf } }))
    frames.push(frame('response.output_item.done', { type: 'response.output_item.done', sequence_number: next(), output_index: outputIndex, item: { id: msgItemId, type: 'message', role: 'assistant', status: 'completed', content: [{ type: 'output_text', text: textBuf }] } }))
    msgOpen = false
    textBuf = ''
    outputIndex++
  }
  const closeTool = (): void => {
    if (!toolOpen) return
    frames.push(frame('response.output_item.done', { type: 'response.output_item.done', sequence_number: next(), output_index: outputIndex, item: { id: toolItemId, type: 'function_call', status: 'completed', call_id: curToolCallId, name: curToolName, arguments: toolArgs } }))
    toolOpen = false
    toolArgs = ''
    outputIndex++
  }

  for (const ev of events) {
    if (ev.type === 'text_delta') {
      closeTool()
      openMessage()
      textBuf += ev.text
      frames.push(frame('response.output_text.delta', { type: 'response.output_text.delta', sequence_number: next(), item_id: msgItemId, output_index: outputIndex, content_index: 0, delta: ev.text }))
    } else if (ev.type === 'thinking_delta') {
      // reasoning 非目标，丢弃
    } else if (ev.type === 'tool_use_start') {
      closeMessage()
      closeTool()
      toolItemId = opts.itemId(outputIndex)
      curToolCallId = ev.id
      curToolName = ev.name
      frames.push(frame('response.output_item.added', { type: 'response.output_item.added', sequence_number: next(), output_index: outputIndex, item: { id: toolItemId, type: 'function_call', status: 'in_progress', call_id: ev.id, name: ev.name, arguments: '' } }))
      toolOpen = true
    } else if (ev.type === 'tool_use_delta') {
      if (toolOpen) {
        toolArgs += ev.partialJson
        frames.push(frame('response.function_call_arguments.delta', { type: 'response.function_call_arguments.delta', sequence_number: next(), item_id: toolItemId, output_index: outputIndex, delta: ev.partialJson }))
      }
    } else if (ev.type === 'usage') {
      finalUsage = ev.usage
    }
  }
  closeMessage()
  closeTool()

  frames.push(frame('response.completed', {
    type: 'response.completed',
    sequence_number: next(),
    response: {
      id: opts.id, object: 'response', created_at: opts.createdAt, status: 'completed', model: resp.model,
      usage: { input_tokens: finalUsage.inputTokens, output_tokens: finalUsage.outputTokens, total_tokens: finalUsage.inputTokens + finalUsage.outputTokens, ...(finalUsage.cacheReadTokens !== undefined ? { input_tokens_details: { cached_tokens: finalUsage.cacheReadTokens } } : {}) },
    },
  }))
  frames.push('data: [DONE]\n\n')
  return frames
}
