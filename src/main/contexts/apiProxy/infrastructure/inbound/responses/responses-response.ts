// IR → Responses output items + usage。纯函数，id/createdAt 由 opts 注入。
import type { CanonicalResponse } from '../../../domain/canonical'
import type { ResponsesObject, ResponseOutputItem, ResponsesUsage } from './responses-types'
import { customToolInputFromChatArguments } from './responses-types'

export interface IrToResponsesOpts {
  id: string
  itemId: (index: number) => string
  createdAt: number
  previousResponseId?: string
  /** custom(freeform)工具名集合：命中者把 tool_use 还原为 custom_tool_call 项(而非 function_call)。 */
  customToolNames?: Set<string>
}

function usageToResponses(usage: CanonicalResponse['usage']): ResponsesUsage {
  // Responses 的 input_tokens 是「总输入（含命中/写入缓存）」；IR inputTokens 仅非缓存新增，
  // 故把 cache 读写补回总输入，cached_tokens 仅取命中读取部分（对齐 OpenAI 语义）。
  const inputTotal = usage.inputTokens + (usage.cacheReadTokens ?? 0) + (usage.cacheWriteTokens ?? 0)
  const out: ResponsesUsage = {
    input_tokens: inputTotal,
    output_tokens: usage.outputTokens,
    total_tokens: inputTotal + usage.outputTokens,
  }
  if (usage.cacheReadTokens !== undefined) {
    out.input_tokens_details = { cached_tokens: usage.cacheReadTokens }
  }
  return out
}

export function irToResponsesResponse(resp: CanonicalResponse, opts: IrToResponsesOpts): ResponsesObject {
  const output: ResponseOutputItem[] = []
  let idx = 0
  let text = ''
  for (const block of resp.content) {
    if (block.type === 'text') text += block.text
  }
  if (text.length > 0) {
    output.push({
      id: opts.itemId(idx++),
      type: 'message',
      role: 'assistant',
      status: 'completed',
      content: [{ type: 'output_text', text }],
    })
  }
  for (const block of resp.content) {
    if (block.type === 'tool_use') {
      const args = JSON.stringify(block.input)
      if (opts.customToolNames?.has(block.name)) {
        // custom(freeform)工具：还原成 custom_tool_call 项，input 取自 arguments 的 input 字段。
        output.push({
          id: opts.itemId(idx++),
          type: 'custom_tool_call',
          status: 'completed',
          call_id: block.id,
          name: block.name,
          input: customToolInputFromChatArguments(args),
        })
      } else {
        output.push({
          id: opts.itemId(idx++),
          type: 'function_call',
          status: 'completed',
          call_id: block.id,
          name: block.name,
          arguments: args,
        })
      }
    }
  }
  return {
    id: opts.id,
    object: 'response',
    created_at: opts.createdAt,
    status: 'completed',
    model: resp.model,
    output,
    usage: usageToResponses(resp.usage),
    ...(opts.previousResponseId ? { previous_response_id: opts.previousResponseId } : {}),
  }
}
