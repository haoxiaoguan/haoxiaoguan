// 入站转换器：Gemini generateContent ↔ 规范 IR。
// Gemini 用 contents[].parts[] + role:'user'|'model'；工具调用为 functionCall part、
// 工具结果为 functionResponse part、图片为 inlineData part、系统提示在顶层 systemInstruction。
// 本层平台无关、确定性纯函数：不读时钟/不发 I/O（不变量 9）。
import type {
  CanonicalRequest,
  CanonicalMessage,
  CanonicalResponse,
  CanonicalStreamEvent,
  ContentBlock,
  ToolDef,
  StopReason,
} from '../../domain/canonical'

// ============ Gemini 线协议类型（子集） ============

export interface GeminiInlineData {
  mimeType: string
  data: string
}

export interface GeminiFunctionCall {
  name: string
  args?: Record<string, unknown>
}

export interface GeminiFunctionResponse {
  name: string
  response: Record<string, unknown>
}

export interface GeminiPart {
  text?: string
  inlineData?: GeminiInlineData
  functionCall?: GeminiFunctionCall
  functionResponse?: GeminiFunctionResponse
}

export interface GeminiContent {
  role?: 'user' | 'model'
  parts: GeminiPart[]
}

export interface GeminiFunctionDeclaration {
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export interface GeminiTool {
  functionDeclarations?: GeminiFunctionDeclaration[]
}

export interface GeminiGenerationConfig {
  maxOutputTokens?: number
  temperature?: number
  topP?: number
}

export type GeminiFunctionCallingMode = 'AUTO' | 'ANY' | 'NONE'

export interface GeminiFunctionCallingConfig {
  mode: GeminiFunctionCallingMode
  allowedFunctionNames?: string[]
}

export interface GeminiToolConfig {
  functionCallingConfig?: GeminiFunctionCallingConfig
}

export interface GeminiGenerateContentRequest {
  contents: GeminiContent[]
  systemInstruction?: { parts: GeminiPart[] }
  tools?: GeminiTool[]
  toolConfig?: GeminiToolConfig
  generationConfig?: GeminiGenerationConfig
}

// 入站时为无 id 的 Gemini functionCall 合成稳定 IR id（同名 functionResponse 用同样规则对齐）。
// Gemini 的 functionCall 无独立 id，靠 name 对齐，故用 `gemini-<name>` 作为可逆兜底 id。
function geminiToolId(name: string): string {
  return `gemini-${name}`
}

function geminiPartsToText(parts: GeminiPart[]): string | undefined {
  const texts = parts.filter((p) => p.text !== undefined).map((p) => p.text as string)
  return texts.length > 0 ? texts.join('\n') : undefined
}

// Gemini parts → IR ContentBlock[]。
function geminiPartsToBlocks(parts: GeminiPart[]): ContentBlock[] {
  const out: ContentBlock[] = []
  for (const p of parts) {
    if (p.text !== undefined && p.text !== '') {
      out.push({ type: 'text', text: p.text })
    } else if (p.inlineData) {
      out.push({ type: 'image', mediaType: p.inlineData.mimeType, data: p.inlineData.data })
    } else if (p.functionCall) {
      out.push({
        type: 'tool_use',
        id: geminiToolId(p.functionCall.name),
        name: p.functionCall.name,
        input: p.functionCall.args ?? {},
      })
    } else if (p.functionResponse) {
      // Gemini functionResponse.response 是任意对象；为可逆 round-trip，统一 JSON.stringify 成 text。
      out.push({
        type: 'tool_result',
        toolUseId: geminiToolId(p.functionResponse.name),
        content: [{ type: 'text', text: JSON.stringify(p.functionResponse.response) }],
      })
    }
  }
  return out
}

function geminiToolsToIR(tools: GeminiTool[] | undefined): ToolDef[] | undefined {
  if (!tools) return undefined
  const defs: ToolDef[] = []
  for (const t of tools) {
    for (const fd of t.functionDeclarations ?? []) {
      defs.push({
        name: fd.name,
        ...(fd.description !== undefined ? { description: fd.description } : {}),
        inputSchema: fd.parameters ?? {},
      })
    }
  }
  return defs.length > 0 ? defs : undefined
}

// ============ geminiToIR ============

/** Gemini generateContent 请求 → CanonicalRequest。model 由 URL 路径段传入（不在 body）。 */
export function geminiToIR(req: GeminiGenerateContentRequest, model: string): CanonicalRequest {
  const messages: CanonicalMessage[] = req.contents.map((c) => ({
    role: c.role === 'model' ? 'assistant' : 'user',
    content: geminiPartsToBlocks(c.parts),
  }))
  const ir: CanonicalRequest = { model, messages, stream: false }
  if (req.systemInstruction) {
    const sys = geminiPartsToText(req.systemInstruction.parts)
    if (sys !== undefined) ir.system = sys
  }
  if (req.generationConfig) {
    if (req.generationConfig.maxOutputTokens !== undefined) ir.maxTokens = req.generationConfig.maxOutputTokens
    if (req.generationConfig.temperature !== undefined) ir.temperature = req.generationConfig.temperature
    if (req.generationConfig.topP !== undefined) ir.topP = req.generationConfig.topP
  }
  const tools = geminiToolsToIR(req.tools)
  if (tools) ir.tools = tools
  return ir
}

// ============ IR → Gemini（响应） ============

export type GeminiFinishReason = 'STOP' | 'MAX_TOKENS'

export interface GeminiUsageMetadata {
  promptTokenCount: number
  candidatesTokenCount: number
  totalTokenCount: number
  cachedContentTokenCount?: number
}

export interface GeminiCandidate {
  content: { role: 'model'; parts: GeminiPart[] }
  finishReason: GeminiFinishReason
  index: number
}

export interface GeminiGenerateContentResponse {
  candidates: GeminiCandidate[]
  usageMetadata: GeminiUsageMetadata
}

// IR StopReason → Gemini finishReason（不变量 6）。
// Gemini 仅区分 STOP / MAX_TOKENS；tool_use 与 stop_sequence 都归到 STOP。
function stopReasonToGemini(reason: StopReason): GeminiFinishReason {
  return reason === 'max_tokens' ? 'MAX_TOKENS' : 'STOP'
}

// IR ContentBlock → Gemini part（响应侧 text / tool_use；thinking 无原生承载，丢弃）。
function irBlockToGeminiPart(block: ContentBlock): GeminiPart | null {
  if (block.type === 'text') return { text: block.text }
  if (block.type === 'tool_use') return { functionCall: { name: block.name, args: block.input } }
  if (block.type === 'image') return { inlineData: { mimeType: block.mediaType, data: block.data } }
  // thinking / tool_result 不在 Gemini 响应 part 体系内，丢弃。
  // 注：Gemini 无原生 thinking 承载，出站时该块被显式丢弃（不变量对齐）。
  return null
}

function usageToGemini(usage: CanonicalResponse['usage']): GeminiUsageMetadata {
  const out: GeminiUsageMetadata = {
    promptTokenCount: usage.inputTokens,
    candidatesTokenCount: usage.outputTokens,
    totalTokenCount: usage.inputTokens + usage.outputTokens,
  }
  if (usage.cacheReadTokens !== undefined) out.cachedContentTokenCount = usage.cacheReadTokens
  return out
}

/** CanonicalResponse → Gemini GenerateContentResponse。 */
export function irToGeminiResponse(resp: CanonicalResponse): GeminiGenerateContentResponse {
  const parts: GeminiPart[] = []
  for (const block of resp.content) {
    const part = irBlockToGeminiPart(block)
    if (part) parts.push(part)
  }
  return {
    candidates: [
      {
        content: { role: 'model', parts },
        finishReason: stopReasonToGemini(resp.stopReason),
        index: 0,
      },
    ],
    usageMetadata: usageToGemini(resp.usage),
  }
}

// ============ IR → Gemini（流式 JSON chunk） ============

interface GeminiStreamChunk {
  candidates: {
    content: { role: 'model'; parts: GeminiPart[] }
    finishReason?: GeminiFinishReason
    index: number
  }[]
  usageMetadata?: GeminiUsageMetadata
}

/**
 * IR 事件序列 → Gemini streamGenerateContent 的 JSON chunk 文本数组（每元素是一个 chunk 的 JSON 串）。
 * - text_delta → 一个含 { text } part 的 chunk。
 * - tool_use_start + 后续 tool_use_delta：累积 name + partialJson，在收到下一个 start 或收尾时 flush 成
 *   一个含 { functionCall } part 的 chunk（Gemini 不流式拆 functionCall，故合并为单 part）。
 * - usage / message_stop：合成最后一个携带 finishReason(+usageMetadata) 的收尾 chunk。
 * thinking_delta 无 Gemini 承载，丢弃。纯函数（不读时钟/不随机，不变量 9）。
 */
export function serializeGeminiStream(events: CanonicalStreamEvent[]): string[] {
  const chunks: GeminiStreamChunk[] = []
  let pendingToolName: string | null = null
  let pendingToolJson = ''
  let finalStop: StopReason = 'end_turn'
  let finalUsage: CanonicalResponse['usage'] | null = null

  const flushTool = (): void => {
    if (pendingToolName !== null) {
      let args: Record<string, unknown> = {}
      try {
        const parsed = JSON.parse(pendingToolJson || '{}')
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
          args = parsed as Record<string, unknown>
        }
      } catch {
        args = {}
      }
      chunks.push({
        candidates: [{ content: { role: 'model', parts: [{ functionCall: { name: pendingToolName, args } }] }, index: 0 }],
      })
      pendingToolName = null
      pendingToolJson = ''
    }
  }

  for (const ev of events) {
    if (ev.type === 'text_delta') {
      chunks.push({ candidates: [{ content: { role: 'model', parts: [{ text: ev.text }] }, index: 0 }] })
    } else if (ev.type === 'thinking_delta') {
      // Gemini 无 thinking 流字段，丢弃。
    } else if (ev.type === 'tool_use_start') {
      flushTool()
      pendingToolName = ev.name
      pendingToolJson = ''
    } else if (ev.type === 'tool_use_delta') {
      pendingToolJson += ev.partialJson
    } else if (ev.type === 'usage') {
      finalUsage = ev.usage
    } else {
      finalStop = ev.stopReason
    }
  }
  // 收尾前 flush 未完成的工具调用。
  flushTool()

  // 收尾 chunk：携带 finishReason（+ usageMetadata，如有 usage 事件）。
  const closing: GeminiStreamChunk = {
    candidates: [{ content: { role: 'model', parts: [] }, finishReason: stopReasonToGemini(finalStop), index: 0 }],
  }
  if (finalUsage) closing.usageMetadata = usageToGemini(finalUsage)
  chunks.push(closing)

  return chunks.map((c) => JSON.stringify(c))
}
