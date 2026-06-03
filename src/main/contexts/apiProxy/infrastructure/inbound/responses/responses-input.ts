// Responses input 三态归一化 + 转 IR（复用 openaiToIR）。纯函数。
// 三态：string | messages 数组 | typed items 数组 → OpenAIMessage[]（Chat 消息形态），再喂 openaiToIR。
// 注：归一化产出的多模态 content part 采用 Chat 线类型（'text' / 'image_url'），
// 以便 openaiToIR 内部的 openAIContentToBlocks 能识别（它只读 part.type === 'text' | 'image_url'）。
import { openaiToIR, type OpenAIMessage, type OpenAIChatRequest } from '../openai'
import type { CanonicalRequest } from '../../../domain/canonical'
import { type ResponsesRequest, responsesToolToOpenAI } from './responses-types'

export function parseResponsesInput(input: unknown): OpenAIMessage[] {
  if (input === undefined || input === null) return []
  if (typeof input === 'string') return input.length > 0 ? [{ role: 'user', content: input }] : []
  if (Array.isArray(input)) return convertInputItems(input)
  if (typeof input === 'object') return convertInputItems([input])
  return []
}

function asStr(v: unknown): string {
  if (typeof v === 'string') return v
  if (v === undefined || v === null) return ''
  try {
    return JSON.stringify(v)
  } catch {
    return ''
  }
}

function convertInputItems(items: unknown[]): OpenAIMessage[] {
  const messages: OpenAIMessage[] = []
  let pendingUser: { type: string; text?: string; [k: string]: unknown }[] = []
  const flush = (): void => {
    if (pendingUser.length > 0) {
      messages.push({ role: 'user', content: pendingUser as never })
      pendingUser = []
    }
  }
  for (const raw of items) {
    if (raw === null || typeof raw !== 'object') continue
    const obj = raw as Record<string, unknown>
    const type = typeof obj.type === 'string' ? obj.type : ''
    const role = typeof obj.role === 'string' ? obj.role : ''
    if (type === 'message' || (type === '' && role !== '')) {
      flush()
      const m = buildMessage(obj, role || 'user')
      if (m) messages.push(m)
    } else if (type === 'function_call_output' || type === 'tool_result') {
      flush()
      const callId =
        (typeof obj.call_id === 'string' ? obj.call_id : undefined) ??
        (typeof obj.tool_call_id === 'string' ? obj.tool_call_id : '')
      const out = asStr(obj.output) || asStr(obj.content)
      messages.push({ role: 'tool', content: out, tool_call_id: callId })
    } else if (type === 'function_call') {
      flush()
      const tc = {
        id: (typeof obj.call_id === 'string' && obj.call_id) || (typeof obj.id === 'string' ? obj.id : ''),
        type: 'function' as const,
        function: { name: typeof obj.name === 'string' ? obj.name : '', arguments: asStr(obj.arguments) },
      }
      const last = messages[messages.length - 1]
      if (
        last &&
        last.role === 'assistant' &&
        last.tool_calls &&
        last.tool_calls.length > 0 &&
        (last.content === '' || last.content == null)
      ) {
        last.tool_calls.push(tc)
      } else {
        messages.push({ role: 'assistant', content: '', tool_calls: [tc] })
      }
    } else if (type === 'input_text' || type === 'text') {
      const t = typeof obj.text === 'string' ? obj.text : ''
      if (t) pendingUser.push({ type: 'text', text: t })
    } else if (type === 'input_image' || type === 'image' || type === 'image_url') {
      pendingUser.push(normalizeImagePart(obj))
    } else if (type === 'output_text') {
      flush()
      const t = typeof obj.text === 'string' ? obj.text : ''
      if (t) messages.push({ role: 'assistant', content: t })
    } else if (role !== '') {
      flush()
      const m = buildMessage(obj, role)
      if (m) messages.push(m)
    }
  }
  flush()
  return messages
}

// Responses 图像 part 归一化到 Chat 线形态 { type:'image_url', image_url:{ url } }，
// 兼容 { type:'input_image', image_url } 与已是 Chat 形态的 { image_url:{ url } }。
function normalizeImagePart(obj: Record<string, unknown>): { type: string; text?: string; [k: string]: unknown } {
  const iu = obj.image_url
  if (typeof iu === 'string') return { type: 'image_url', image_url: { url: iu } }
  if (iu && typeof iu === 'object') return { type: 'image_url', image_url: iu }
  return { type: 'image_url', ...obj }
}

function buildMessage(obj: Record<string, unknown>, role: string): OpenAIMessage | null {
  const r = role as OpenAIMessage['role']
  const content = obj.content
  if (typeof content === 'string') return { role: r, content }
  if (Array.isArray(content)) {
    const parts: { type: string; text?: string; [k: string]: unknown }[] = []
    let textOnly = ''
    let anyNonText = false
    for (const p of content) {
      if (p === null || typeof p !== 'object') continue
      const part = p as Record<string, unknown>
      const pt = typeof part.type === 'string' ? part.type : ''
      if (pt === 'input_text' || pt === 'text' || pt === 'output_text') {
        const t = typeof part.text === 'string' ? part.text : ''
        textOnly += t
        if (t) parts.push({ type: 'text', text: t })
      } else if (pt === 'input_image' || pt === 'image' || pt === 'image_url') {
        anyNonText = true
        parts.push(normalizeImagePart(part))
      }
    }
    return anyNonText ? { role: r, content: parts as never } : { role: r, content: textOnly }
  }
  if (typeof obj.text === 'string' && obj.text) return { role: r, content: obj.text }
  return null
}

export interface ResponsesToIROpts {
  historyMessages?: OpenAIMessage[]
}

export function responsesToIR(req: ResponsesRequest, opts: ResponsesToIROpts): CanonicalRequest {
  const inputMessages = parseResponsesInput(req.input)
  const messages: OpenAIMessage[] = [...(opts.historyMessages ?? []), ...inputMessages]
  if (req.instructions && req.instructions.length > 0) {
    messages.unshift({ role: 'system', content: req.instructions })
  }
  const chatReq: OpenAIChatRequest = {
    model: req.model ?? 'gpt-4.1',
    messages,
    stream: req.stream ?? false,
    ...(req.max_output_tokens !== undefined ? { max_tokens: req.max_output_tokens } : {}),
    ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
    ...(req.tools ? { tools: req.tools.map(responsesToolToOpenAI) } : {}),
  }
  return openaiToIR(chatReq)
}
