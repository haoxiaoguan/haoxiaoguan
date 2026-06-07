// 第三方中转「出站」镜像转换器：Canonical IR ↔ Gemini generateContent（上游方向）。
// inbound/gemini.ts 是「客户端线协议 ↔ IR」入站对；本文件是其镜像「IR ↔ 上游线协议」出站对：
//   - irToGeminiRequest:            IR → 上游请求体（model 在路径中，不进 body）
//   - geminiResponseToIR:           上游非流式 JSON → CanonicalResponse
//   - createGeminiSseToEventsParser: 上游 SSE（增量、半帧）→ CanonicalStreamEvent[]
// 平台无关、确定性纯函数：不读时钟/随机；bytecode 安全：闭包工厂 + 对象方法，无 class 字段箭头。
// 禁：Date.now/Math.random/crypto.randomUUID；禁动态 import()。
import type {
  CanonicalRequest,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
  StopReason,
  Usage,
} from '../../../domain/canonical'
import type {
  GeminiGenerateContentRequest,
  GeminiGenerateContentResponse,
  GeminiContent,
  GeminiPart,
  GeminiTool,
  GeminiToolConfig,
  GeminiGenerationConfig,
} from '../../inbound/gemini'
import type { RelayStreamParser } from './relay-codec'

// ============ IR → Gemini 请求体 ============

/** IR CanonicalMessage role → Gemini content role。 */
function irRoleToGemini(role: 'user' | 'assistant'): 'user' | 'model' {
  return role === 'assistant' ? 'model' : 'user'
}

/** IR ContentBlock → Gemini part（请求侧：text/image/tool_use/tool_result）。 */
function irBlockToGeminiPart(block: ContentBlock): GeminiPart | null {
  if (block.type === 'text') {
    return { text: block.text }
  }
  if (block.type === 'image') {
    return { inlineData: { mimeType: block.mediaType, data: block.data } }
  }
  if (block.type === 'tool_use') {
    return { functionCall: { name: block.name, args: block.input as Record<string, unknown> } }
  }
  if (block.type === 'tool_result') {
    // Gemini functionResponse.response 是任意对象；tool_result.content 收敛为文本后封装进 response。
    const text = block.content
      .filter((c): c is { type: 'text'; text: string } => c.type === 'text')
      .map((c) => c.text)
      .join('')
    return { functionResponse: { name: block.toolUseId.startsWith('gemini-') ? block.toolUseId.slice('gemini-'.length) : block.toolUseId, response: { content: text } } }
  }
  // thinking 无 Gemini 承载，丢弃。
  return null
}

/**
 * CanonicalRequest → Gemini generateContent 请求体（geminiToIR 的逆）。
 * model 不进 body（在 URL 路径），stream 不进 body（靠 endpoint 区分）。
 */
export function irToGeminiRequest(ir: CanonicalRequest): GeminiGenerateContentRequest {
  const contents: GeminiContent[] = ir.messages.map((msg) => {
    const parts: GeminiPart[] = []
    for (const block of msg.content) {
      const part = irBlockToGeminiPart(block)
      if (part !== null) parts.push(part)
    }
    return { role: irRoleToGemini(msg.role), parts }
  })

  const out: GeminiGenerateContentRequest = { contents }

  if (ir.system !== undefined && ir.system.length > 0) {
    out.systemInstruction = { parts: [{ text: ir.system }] }
  }

  if (ir.tools && ir.tools.length > 0) {
    const functionDeclarations = ir.tools.map((t) => ({
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      parameters: t.inputSchema,
    }))
    const tool: GeminiTool = { functionDeclarations }
    out.tools = [tool]
  }

  if (ir.toolChoice !== undefined) {
    const tc = ir.toolChoice
    let toolConfig: GeminiToolConfig | undefined
    if (tc.type === 'auto') {
      toolConfig = { functionCallingConfig: { mode: 'AUTO' } }
    } else if (tc.type === 'none') {
      toolConfig = { functionCallingConfig: { mode: 'NONE' } }
    } else if (tc.type === 'any') {
      toolConfig = { functionCallingConfig: { mode: 'ANY' } }
    } else if (tc.type === 'tool') {
      toolConfig = { functionCallingConfig: { mode: 'ANY', allowedFunctionNames: [tc.name] } }
    }
    if (toolConfig !== undefined) out.toolConfig = toolConfig
  }

  const genConfig: GeminiGenerationConfig = {}
  let hasGenConfig = false
  if (ir.maxTokens !== undefined) { genConfig.maxOutputTokens = ir.maxTokens; hasGenConfig = true }
  if (ir.temperature !== undefined) { genConfig.temperature = ir.temperature; hasGenConfig = true }
  if (ir.topP !== undefined) { genConfig.topP = ir.topP; hasGenConfig = true }
  if (hasGenConfig) out.generationConfig = genConfig

  return out
}

// ============ Gemini 响应 → IR ============

/** Gemini finishReason → IR StopReason。 */
function geminiFinishReasonToIR(reason: string | undefined): StopReason {
  if (reason === 'MAX_TOKENS') return 'max_tokens'
  if (reason === 'STOP') return 'end_turn'
  return 'end_turn'
}

/** Gemini part → IR ContentBlock（响应侧：text/functionCall）。 */
function geminiPartToIRBlock(part: GeminiPart): ContentBlock | null {
  if (part.text !== undefined && part.text.length > 0) {
    return { type: 'text', text: part.text }
  }
  if (part.functionCall) {
    return {
      type: 'tool_use',
      id: `gemini-${part.functionCall.name}`,
      name: part.functionCall.name,
      input: part.functionCall.args ?? {},
    }
  }
  return null
}

/**
 * Gemini GenerateContentResponse → CanonicalResponse（irToGeminiResponse 的逆）。
 * candidates[0].content.parts → IR content；finishReason → StopReason；usageMetadata → Usage。
 */
export function geminiResponseToIR(raw: GeminiGenerateContentResponse): CanonicalResponse {
  const candidate = raw.candidates?.[0]
  const content: ContentBlock[] = []
  if (candidate?.content?.parts) {
    for (const part of candidate.content.parts) {
      const block = geminiPartToIRBlock(part)
      if (block !== null) content.push(block)
    }
  }

  const usage: Usage = {
    inputTokens: raw.usageMetadata?.promptTokenCount ?? 0,
    outputTokens: raw.usageMetadata?.candidatesTokenCount ?? 0,
  }

  return {
    model: '',
    content,
    stopReason: geminiFinishReasonToIR(candidate?.finishReason),
    usage,
  }
}

// ============ Gemini SSE → IR 事件（增量状态机） ============

// Gemini streamGenerateContent?alt=sse 回的 JSON chunk（GenerateContentResponse 形）。
interface GeminiStreamPart {
  text?: string
  functionCall?: { name: string; args?: Record<string, unknown> }
}
interface GeminiStreamCandidate {
  content?: { role?: string; parts?: GeminiStreamPart[] }
  finishReason?: string
}
interface GeminiStreamChunk {
  candidates?: GeminiStreamCandidate[]
  usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number }
}

/**
 * 创建 Gemini streamGenerateContent SSE → IR 事件流的增量解析器。
 * 处理：半帧缓冲（按 \n 切行）、`data: {json}` 每块。
 *
 * 映射规则：
 *   text part     → text_delta
 *   functionCall part → tool_use_start{index,id:'gemini-<name>',name} + tool_use_delta{index,partialJson:JSON.stringify(args)}
 *                       （Gemini 一次性给完整 functionCall，index 用递增计数器，每个 functionCall 新 index）
 *   finishReason 非空 → message_stop（顺序：stop 在前）
 *   usageMetadata     → usage（顺序：usage 在后）
 * 畸形帧跳过，不中断。
 */
export function createGeminiSseToEventsParser(): RelayStreamParser {
  let buffer = ''
  let toolIndex = 0

  function processDataLine(line: string): CanonicalStreamEvent[] {
    const events: CanonicalStreamEvent[] = []
    const trimmed = line.replace(/\r$/, '').trimStart()
    if (!trimmed.startsWith('data:')) return events
    const data = trimmed.slice('data:'.length).trim()
    if (data === '') return events

    let chunk: GeminiStreamChunk
    try {
      chunk = JSON.parse(data) as GeminiStreamChunk
    } catch {
      return events // 畸形 JSON 跳过
    }

    const candidate = chunk.candidates?.[0]
    if (candidate?.content?.parts) {
      for (const part of candidate.content.parts) {
        if (part.text !== undefined && part.text.length > 0) {
          events.push({ type: 'text_delta', text: part.text })
        } else if (part.functionCall) {
          const name = part.functionCall.name
          const idx = toolIndex
          toolIndex += 1
          events.push({ type: 'tool_use_start', index: idx, id: `gemini-${name}`, name })
          events.push({
            type: 'tool_use_delta',
            index: idx,
            partialJson: JSON.stringify(part.functionCall.args ?? {}),
          })
        }
      }
    }

    if (candidate?.finishReason !== undefined && candidate.finishReason !== '') {
      events.push({ type: 'message_stop', stopReason: geminiFinishReasonToIR(candidate.finishReason) })
    }

    if (chunk.usageMetadata !== undefined) {
      const usage: Usage = {
        inputTokens: chunk.usageMetadata.promptTokenCount ?? 0,
        outputTokens: chunk.usageMetadata.candidatesTokenCount ?? 0,
      }
      events.push({ type: 'usage', usage })
    }

    return events
  }

  return {
    push(textChunk: string): CanonicalStreamEvent[] {
      buffer += textChunk
      const events: CanonicalStreamEvent[] = []
      let nl = buffer.indexOf('\n')
      while (nl >= 0) {
        const line = buffer.slice(0, nl)
        buffer = buffer.slice(nl + 1)
        for (const ev of processDataLine(line)) events.push(ev)
        nl = buffer.indexOf('\n')
      }
      return events
    },
    flush(): CanonicalStreamEvent[] {
      if (buffer.trim() === '') {
        buffer = ''
        return []
      }
      const events = processDataLine(buffer)
      buffer = ''
      return events
    },
  }
}

/** 便捷：把完整 Gemini SSE 文本一次性解析成 IR 事件序列（测试/非流式场景用）。 */
export function parseGeminiSse(fullSseText: string): CanonicalStreamEvent[] {
  const parser = createGeminiSseToEventsParser()
  return [...parser.push(fullSseText), ...parser.flush()]
}
