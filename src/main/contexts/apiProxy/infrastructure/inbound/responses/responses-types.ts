// OpenAI Responses API 线协议类型（仅本协议需要的子集）。
import type { OpenAITool } from '../openai'

export interface ResponsesRequest {
  model?: string
  input: unknown // string | array | object（延迟解析）
  instructions?: string
  stream?: boolean
  tools?: ResponsesTool[]
  previous_response_id?: string
  store?: boolean
  temperature?: number
  max_output_tokens?: number
  metadata?: Record<string, string>
}

// Responses 工具扁平（name 顶层），区别于 Chat 嵌套 function:{...}。
export interface ResponsesTool {
  type: 'function'
  name: string
  description?: string
  parameters?: Record<string, unknown>
}

export interface ResponseContentPart {
  type: 'output_text'
  text: string
}

export interface ResponseOutputItem {
  id: string
  type: 'message' | 'function_call' | 'custom_tool_call'
  role?: 'assistant'
  status?: 'completed'
  content?: ResponseContentPart[]
  call_id?: string
  name?: string
  arguments?: string
  /** custom_tool_call：freeform 工具的原始字符串输入。 */
  input?: string
}

export interface ResponsesUsage {
  input_tokens: number
  output_tokens: number
  total_tokens: number
  input_tokens_details?: { cached_tokens: number }
}

export interface ResponsesObject {
  id: string
  object: 'response'
  created_at: number
  status: string
  model: string
  output: ResponseOutputItem[]
  usage: ResponsesUsage
  previous_response_id?: string
  metadata?: Record<string, string>
}

// 扁平 ResponsesTool → Chat 嵌套 OpenAITool（复用 openaiToIR 的 mapTools）。
export function responsesToolToOpenAI(t: ResponsesTool): OpenAITool {
  return {
    type: 'function',
    function: {
      name: t.name,
      ...(t.description !== undefined ? { description: t.description } : {}),
      ...(t.parameters !== undefined ? { parameters: t.parameters } : {}),
    },
  }
}

// ─── custom(freeform)工具映射 ──────────────────────────────────────────────
// Codex 对 chat-only 上游(GLM 等)会发 `type:"custom"` 的 freeform 工具(如 apply_patch,带 grammar
// format)。chat completions 无 custom 工具概念,故映射成「带单个 string `input` 字段的 function」,
// 把原始 custom 工具定义嵌进 description 让模型照原样产出 freeform 文本;响应侧再把 function_call 还原
// 成 Responses `custom_tool_call`(见 responses-stream / irToResponsesResponse)。形态对齐参考实现,保兼容。
export const CUSTOM_TOOL_INPUT_FIELD = 'input'
export const CUSTOM_TOOL_INPUT_DESCRIPTION =
  'Raw string input for the original custom tool. Preserve formatting exactly and follow the original tool definition embedded in the description.'
const CUSTOM_TOOL_PRESERVED_METADATA_HEADING = 'Original tool definition:'

/** 运行时判断 custom(freeform)工具：type==='custom'（类型声明虽窄为 'function'，Codex 实际发 custom）。 */
export function isResponsesCustomTool(t: unknown): boolean {
  return typeof t === 'object' && t !== null && (t as { type?: unknown }).type === 'custom'
}

/** custom 工具 → chat function：单 string `input` 字段；原始定义(整 tool JSON)嵌入 description。 */
export function responsesCustomToolToOpenAI(t: ResponsesTool): OpenAITool {
  const description = `${CUSTOM_TOOL_PRESERVED_METADATA_HEADING}\n\`\`\`json\n${JSON.stringify(t)}\n\`\`\``
  return {
    type: 'function',
    function: {
      name: t.name,
      description,
      parameters: {
        type: 'object',
        properties: {
          [CUSTOM_TOOL_INPUT_FIELD]: { type: 'string', description: CUSTOM_TOOL_INPUT_DESCRIPTION },
        },
        required: [CUSTOM_TOOL_INPUT_FIELD],
      },
    },
  }
}

/** 从 chat function_call 的 arguments(JSON 串)提取 custom 工具的 freeform `input` 文本。
 *  parse 为对象且含 input 字段 → 取该字符串；否则原样返回 arguments(空串→空串)。 */
export function customToolInputFromChatArguments(args: string): string {
  const trimmed = args.trim()
  if (trimmed.length === 0) return ''
  try {
    const parsed = JSON.parse(trimmed) as unknown
    if (parsed !== null && typeof parsed === 'object' && !Array.isArray(parsed)) {
      const v = (parsed as Record<string, unknown>)[CUSTOM_TOOL_INPUT_FIELD]
      if (typeof v === 'string') return v
    }
  } catch {
    /* 非 JSON → 原样 */
  }
  return args
}
