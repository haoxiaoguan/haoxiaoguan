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
  type: 'message' | 'function_call'
  role?: 'assistant'
  status?: 'completed'
  content?: ResponseContentPart[]
  call_id?: string
  name?: string
  arguments?: string
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
