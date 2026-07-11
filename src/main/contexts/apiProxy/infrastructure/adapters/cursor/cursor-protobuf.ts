// Cursor Connect-RPC protobuf 编解码（忠实移植自 9router open-sse/utils/cursorProtobuf.js）。
//
// 逆向的是 Cursor 私有上游 aiserver.v1.ChatService/StreamUnifiedChatWithTools 的 wire 协议：
// 手写 protobuf（varint / LEN / VARINT tag）+ Connect-RPC 帧（1 字节 flags + 4 字节大端长度 + payload，
// 可选 gzip）。字段号（FIELD 表）逐字照抄自 9router，任何改动都可能被上游拒收——**勿"优化"**。
//
// 与 9router 的唯一差异：消息 id / conversationId / metadata 时间戳等非确定性来源改为可注入
// （CursorEncodeDeps），默认用真实 randomUUID / Date.now，运行时行为与 9router 一致，单测可注入固定值，
// 满足适配器确定性契约。
import { randomUUID } from 'node:crypto'
import zlib from 'node:zlib'

const textEncoder = new TextEncoder()
const textDecoder = new TextDecoder()

export const PROTOBUF_SCHEMA_VERSION = '1.1.3'

// ==================== 常量（逐字照抄 9router） ====================

const WIRE_TYPE = { VARINT: 0, FIXED64: 1, LEN: 2, FIXED32: 5 } as const

const ROLE = { USER: 1, ASSISTANT: 2 } as const

const UNIFIED_MODE = { CHAT: 1, AGENT: 2 } as const

const THINKING_LEVEL = { UNSPECIFIED: 0, MEDIUM: 1, HIGH: 2 } as const

const CLIENT_SIDE_TOOL_V2_MCP = 19

const FIELD = {
  // StreamUnifiedChatRequestWithTools (top level)
  REQUEST: 1,

  // StreamUnifiedChatRequest
  MESSAGES: 1,
  UNKNOWN_2: 2,
  INSTRUCTION: 3,
  UNKNOWN_4: 4,
  MODEL: 5,
  WEB_TOOL: 8,
  UNKNOWN_13: 13,
  CURSOR_SETTING: 15,
  UNKNOWN_19: 19,
  CONVERSATION_ID: 23,
  METADATA: 26,
  IS_AGENTIC: 27,
  SUPPORTED_TOOLS: 29,
  MESSAGE_IDS: 30,
  MCP_TOOLS: 34,
  LARGE_CONTEXT: 35,
  UNKNOWN_38: 38,
  UNIFIED_MODE: 46,
  UNKNOWN_47: 47,
  SHOULD_DISABLE_TOOLS: 48,
  THINKING_LEVEL: 49,
  UNKNOWN_51: 51,
  UNKNOWN_53: 53,
  UNIFIED_MODE_NAME: 54,

  // ConversationMessage
  MSG_CONTENT: 1,
  MSG_ROLE: 2,
  MSG_ID: 13,
  MSG_TOOL_RESULTS: 18,
  MSG_IS_AGENTIC: 29,
  MSG_SERVER_BUBBLE_ID: 32,
  MSG_UNIFIED_MODE: 47,
  MSG_SUPPORTED_TOOLS: 51,

  // ConversationMessage.ToolResult
  TOOL_RESULT_CALL_ID: 1,
  TOOL_RESULT_NAME: 2,
  TOOL_RESULT_INDEX: 3,
  TOOL_RESULT_RAW_ARGS: 5,
  TOOL_RESULT_RESULT: 8,
  TOOL_RESULT_TOOL_CALL: 11,
  TOOL_RESULT_MODEL_CALL_ID: 12,

  // ClientSideToolV2Result 别名
  CV2R_TOOL: 1,
  CV2R_MCP_RESULT: 28,
  CV2R_CALL_ID: 35,
  CV2R_MODEL_CALL_ID: 48,
  CV2R_TOOL_INDEX: 49,

  // MCPResult 别名
  MCPR_SELECTED_TOOL: 1,
  MCPR_RESULT: 2,

  // ClientSideToolV2Call 别名
  CV2C_TOOL: 1,
  CV2C_MCP_PARAMS: 27,
  CV2C_CALL_ID: 3,
  CV2C_NAME: 9,
  CV2C_RAW_ARGS: 10,
  CV2C_TOOL_INDEX: 48,
  CV2C_MODEL_CALL_ID: 49,

  // Model
  MODEL_NAME: 1,
  MODEL_EMPTY: 4,

  // Instruction
  INSTRUCTION_TEXT: 1,

  // CursorSetting
  SETTING_PATH: 1,
  SETTING_UNKNOWN_3: 3,
  SETTING_UNKNOWN_6: 6,
  SETTING_UNKNOWN_8: 8,
  SETTING_UNKNOWN_9: 9,

  // CursorSetting.Unknown6
  SETTING6_FIELD_1: 1,
  SETTING6_FIELD_2: 2,

  // Metadata
  META_PLATFORM: 1,
  META_ARCH: 2,
  META_VERSION: 3,
  META_CWD: 4,
  META_TIMESTAMP: 5,

  // MessageId
  MSGID_ID: 1,
  MSGID_SUMMARY: 2,
  MSGID_ROLE: 3,

  // MCPTool
  MCP_TOOL_NAME: 1,
  MCP_TOOL_DESC: 2,
  MCP_TOOL_PARAMS: 3,
  MCP_TOOL_SERVER: 4,

  // StreamUnifiedChatResponseWithTools (response)
  TOOL_CALL: 1,
  RESPONSE: 2,

  // ClientSideToolV2Call (response)
  TOOL_ID: 3,
  TOOL_NAME: 9,
  TOOL_RAW_ARGS: 10,
  TOOL_IS_LAST: 11,
  TOOL_MCP_PARAMS: 27,

  // MCPParams
  MCP_TOOLS_LIST: 1,

  // MCPParams.Tool
  MCP_NESTED_NAME: 1,
  MCP_NESTED_PARAMS: 3,

  // StreamUnifiedChatResponse
  RESPONSE_TEXT: 1,
  THINKING: 25,

  // Thinking
  THINKING_TEXT: 1,
} as const

const KNOWN_RESPONSE_FIELDS = new Set<number>([
  FIELD.TOOL_CALL,
  FIELD.RESPONSE,
  FIELD.TOOL_ID,
  FIELD.TOOL_NAME,
  FIELD.TOOL_RAW_ARGS,
  FIELD.TOOL_IS_LAST,
  FIELD.TOOL_MCP_PARAMS,
  FIELD.RESPONSE_TEXT,
  FIELD.THINKING,
])

// ==================== 注入依赖（确定性契约） ====================

export interface CursorEncodeDeps {
  /** 生成 messageId / conversationId 的函数；默认 crypto.randomUUID。 */
  genId?: () => string
  /** 当前时间（ms）；默认 Date.now。用于 metadata 时间戳。 */
  now?: () => number
}

// ==================== 输入形状 ====================

export interface CursorToolResult {
  tool_call_id?: string
  tool_name?: string
  name?: string
  raw_args?: string
  result_content?: string
  result?: string
  tool_index?: number
  index?: number
}

export interface CursorInputMessage {
  role: string
  content: string
  tool_calls?: unknown[]
  tool_results?: CursorToolResult[]
}

export interface CursorToolDef {
  function?: { name?: string; description?: string; parameters?: unknown }
  name?: string
  description?: string
  input_schema?: unknown
}

// ==================== 基础编码 ====================

export function encodeVarint(value: number): Uint8Array {
  const bytes: number[] = []
  while (value >= 0x80) {
    bytes.push((value & 0x7f) | 0x80)
    value >>>= 7
  }
  bytes.push(value & 0x7f)
  return new Uint8Array(bytes)
}

export function encodeField(fieldNum: number, wireType: number, value: unknown): Uint8Array {
  const tag = (fieldNum << 3) | wireType
  const tagBytes = encodeVarint(tag)

  if (wireType === WIRE_TYPE.VARINT) {
    const valueBytes = encodeVarint(value as number)
    return concatArrays(tagBytes, valueBytes)
  }

  if (wireType === WIRE_TYPE.LEN) {
    const dataBytes =
      typeof value === 'string'
        ? textEncoder.encode(value)
        : value instanceof Uint8Array
          ? value
          : Buffer.isBuffer(value)
            ? new Uint8Array(value)
            : new Uint8Array(0)

    const lengthBytes = encodeVarint(dataBytes.length)
    return concatArrays(tagBytes, lengthBytes, dataBytes)
  }

  return new Uint8Array(0)
}

function concatArrays(...arrays: Uint8Array[]): Uint8Array {
  const totalLength = arrays.reduce((sum, arr) => sum + arr.length, 0)
  const result = new Uint8Array(totalLength)
  let offset = 0
  for (const arr of arrays) {
    result.set(arr, offset)
    offset += arr.length
  }
  return result
}

// ==================== 消息编码 ====================

/** "toolName" → "mcp_custom_toolName"；"mcp__server__tool" → "mcp_server_tool"。 */
function formatToolName(name: string): string {
  const base = typeof name === 'string' && name.length > 0 ? name : 'tool'

  if (base.startsWith('mcp__')) {
    const rest = base.slice('mcp__'.length)
    const splitIdx = rest.indexOf('__')
    if (splitIdx >= 0) {
      const server = rest.slice(0, splitIdx) || 'custom'
      const toolName = rest.slice(splitIdx + 2) || 'tool'
      return `mcp_${server}_${toolName}`
    }
    return `mcp_custom_${rest || 'tool'}`
  }

  if (base.startsWith('mcp_')) return base
  return `mcp_custom_${base}`
}

/** "mcp_server_tool" → { serverName, selectedTool }。 */
function parseToolName(formattedName: string): { serverName: string; selectedTool: string } {
  if (typeof formattedName !== 'string' || !formattedName.startsWith('mcp_')) {
    return { serverName: 'custom', selectedTool: formattedName || 'tool' }
  }

  const tail = formattedName.slice('mcp_'.length)
  const splitIdx = tail.indexOf('_')
  if (splitIdx < 0) {
    return { serverName: 'custom', selectedTool: tail || 'tool' }
  }

  return {
    serverName: tail.slice(0, splitIdx) || 'custom',
    selectedTool: tail.slice(splitIdx + 1) || 'tool',
  }
}

/** tool_call_id → { toolCallId, modelCallId }（Cursor 用 "\nmc_" 分隔 model_call_id）。 */
function parseToolId(id: string): { toolCallId: string; modelCallId: string | null } {
  const delimiter = '\nmc_'
  const idx = id.indexOf(delimiter)
  if (idx >= 0) {
    return { toolCallId: id.slice(0, idx), modelCallId: id.slice(idx + delimiter.length) }
  }
  return { toolCallId: id, modelCallId: null }
}

function encodeMcpResult(selectedTool: string, resultContent: string): Uint8Array {
  return concatArrays(
    encodeField(FIELD.MCPR_SELECTED_TOOL, WIRE_TYPE.LEN, selectedTool),
    encodeField(FIELD.MCPR_RESULT, WIRE_TYPE.LEN, resultContent),
  )
}

function encodeClientSideToolV2Result(
  toolCallId: string,
  modelCallId: string | null,
  selectedTool: string,
  resultContent: string,
  toolIndex = 1,
): Uint8Array {
  return concatArrays(
    encodeField(FIELD.CV2R_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2R_MCP_RESULT, WIRE_TYPE.LEN, encodeMcpResult(selectedTool, resultContent)),
    encodeField(FIELD.CV2R_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    ...(modelCallId ? [encodeField(FIELD.CV2R_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : []),
    encodeField(FIELD.CV2R_TOOL_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1),
  )
}

function encodeMcpParamsForCall(toolName: string, rawArgs: string, serverName: string): Uint8Array {
  const tool = concatArrays(
    encodeField(FIELD.MCP_TOOL_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.MCP_TOOL_PARAMS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.MCP_TOOL_SERVER, WIRE_TYPE.LEN, serverName),
  )
  return encodeField(FIELD.MCP_TOOLS_LIST, WIRE_TYPE.LEN, tool)
}

function encodeClientSideToolV2Call(
  toolCallId: string,
  toolName: string,
  selectedTool: string,
  serverName: string,
  rawArgs: string,
  modelCallId: string | null,
  toolIndex = 1,
): Uint8Array {
  return concatArrays(
    encodeField(FIELD.CV2C_TOOL, WIRE_TYPE.VARINT, CLIENT_SIDE_TOOL_V2_MCP),
    encodeField(FIELD.CV2C_MCP_PARAMS, WIRE_TYPE.LEN, encodeMcpParamsForCall(selectedTool, rawArgs, serverName)),
    encodeField(FIELD.CV2C_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    encodeField(FIELD.CV2C_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.CV2C_RAW_ARGS, WIRE_TYPE.LEN, rawArgs),
    encodeField(FIELD.CV2C_TOOL_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1),
    ...(modelCallId ? [encodeField(FIELD.CV2C_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : []),
  )
}

export function encodeToolResult(toolResult: CursorToolResult): Uint8Array {
  const originalName = toolResult.tool_name || toolResult.name || ''
  const toolName = formatToolName(originalName)
  const rawArgs = toolResult.raw_args || '{}'
  const resultContent = toolResult.result_content || toolResult.result || ''
  const { toolCallId, modelCallId } = parseToolId(toolResult.tool_call_id || '')
  const toolIndex = toolResult.tool_index || toolResult.index || 1

  const { serverName, selectedTool } = parseToolName(toolName)

  return concatArrays(
    encodeField(FIELD.TOOL_RESULT_CALL_ID, WIRE_TYPE.LEN, toolCallId),
    encodeField(FIELD.TOOL_RESULT_NAME, WIRE_TYPE.LEN, toolName),
    encodeField(FIELD.TOOL_RESULT_INDEX, WIRE_TYPE.VARINT, toolIndex > 0 ? toolIndex : 1),
    ...(modelCallId ? [encodeField(FIELD.TOOL_RESULT_MODEL_CALL_ID, WIRE_TYPE.LEN, modelCallId)] : []),
    encodeField(FIELD.TOOL_RESULT_RAW_ARGS, WIRE_TYPE.LEN, rawArgs),
    encodeField(
      FIELD.TOOL_RESULT_RESULT,
      WIRE_TYPE.LEN,
      encodeClientSideToolV2Result(toolCallId, modelCallId, selectedTool, resultContent, toolIndex),
    ),
    encodeField(
      FIELD.TOOL_RESULT_TOOL_CALL,
      WIRE_TYPE.LEN,
      encodeClientSideToolV2Call(toolCallId, toolName, selectedTool, serverName, rawArgs, modelCallId, toolIndex),
    ),
  )
}

export function encodeMessage(
  content: string,
  role: number,
  messageId: string,
  _chatModeEnum: number | null = null,
  isLast = false,
  hasTools = false,
  toolResults: CursorToolResult[] = [],
  serverBubbleId: string | null = null,
): Uint8Array {
  const hasToolResults = toolResults.length > 0
  return concatArrays(
    encodeField(FIELD.MSG_CONTENT, WIRE_TYPE.LEN, content),
    encodeField(FIELD.MSG_ROLE, WIRE_TYPE.VARINT, role),
    encodeField(FIELD.MSG_ID, WIRE_TYPE.LEN, messageId),
    ...(serverBubbleId ? [encodeField(FIELD.MSG_SERVER_BUBBLE_ID, WIRE_TYPE.LEN, serverBubbleId)] : []),
    ...(hasToolResults
      ? toolResults.map((tr) => encodeField(FIELD.MSG_TOOL_RESULTS, WIRE_TYPE.LEN, encodeToolResult(tr)))
      : []),
    encodeField(FIELD.MSG_IS_AGENTIC, WIRE_TYPE.VARINT, hasTools ? 1 : 0),
    encodeField(FIELD.MSG_UNIFIED_MODE, WIRE_TYPE.VARINT, hasTools ? UNIFIED_MODE.AGENT : UNIFIED_MODE.CHAT),
    ...(isLast && hasTools ? [encodeField(FIELD.MSG_SUPPORTED_TOOLS, WIRE_TYPE.LEN, encodeVarint(1))] : []),
  )
}

export function encodeInstruction(text: string): Uint8Array {
  return text ? encodeField(FIELD.INSTRUCTION_TEXT, WIRE_TYPE.LEN, text) : new Uint8Array(0)
}

export function encodeModel(modelName: string): Uint8Array {
  return concatArrays(
    encodeField(FIELD.MODEL_NAME, WIRE_TYPE.LEN, modelName),
    encodeField(FIELD.MODEL_EMPTY, WIRE_TYPE.LEN, new Uint8Array(0)),
  )
}

export function encodeCursorSetting(): Uint8Array {
  const unknown6 = concatArrays(
    encodeField(FIELD.SETTING6_FIELD_1, WIRE_TYPE.LEN, new Uint8Array(0)),
    encodeField(FIELD.SETTING6_FIELD_2, WIRE_TYPE.LEN, new Uint8Array(0)),
  )

  return concatArrays(
    encodeField(FIELD.SETTING_PATH, WIRE_TYPE.LEN, 'cursor\\aisettings'),
    encodeField(FIELD.SETTING_UNKNOWN_3, WIRE_TYPE.LEN, new Uint8Array(0)),
    encodeField(FIELD.SETTING_UNKNOWN_6, WIRE_TYPE.LEN, unknown6),
    encodeField(FIELD.SETTING_UNKNOWN_8, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.SETTING_UNKNOWN_9, WIRE_TYPE.VARINT, 1),
  )
}

export function encodeMetadata(now: () => number): Uint8Array {
  return concatArrays(
    encodeField(FIELD.META_PLATFORM, WIRE_TYPE.LEN, process.platform || 'linux'),
    encodeField(FIELD.META_ARCH, WIRE_TYPE.LEN, process.arch || 'x64'),
    encodeField(FIELD.META_VERSION, WIRE_TYPE.LEN, process.version || 'v20.0.0'),
    encodeField(FIELD.META_CWD, WIRE_TYPE.LEN, process.cwd?.() || '/'),
    encodeField(FIELD.META_TIMESTAMP, WIRE_TYPE.LEN, new Date(now()).toISOString()),
  )
}

export function encodeMessageId(messageId: string, role: number, summaryId: string | null = null): Uint8Array {
  return concatArrays(
    encodeField(FIELD.MSGID_ID, WIRE_TYPE.LEN, messageId),
    ...(summaryId ? [encodeField(FIELD.MSGID_SUMMARY, WIRE_TYPE.LEN, summaryId)] : []),
    encodeField(FIELD.MSGID_ROLE, WIRE_TYPE.VARINT, role),
  )
}

export function encodeMcpTool(tool: CursorToolDef): Uint8Array {
  const toolName = tool.function?.name || tool.name || ''
  const toolDesc = tool.function?.description || tool.description || ''
  const inputSchema = tool.function?.parameters || tool.input_schema || {}

  return concatArrays(
    ...(toolName ? [encodeField(FIELD.MCP_TOOL_NAME, WIRE_TYPE.LEN, toolName)] : []),
    ...(toolDesc ? [encodeField(FIELD.MCP_TOOL_DESC, WIRE_TYPE.LEN, toolDesc)] : []),
    ...(Object.keys(inputSchema as object).length > 0
      ? [encodeField(FIELD.MCP_TOOL_PARAMS, WIRE_TYPE.LEN, JSON.stringify(inputSchema))]
      : []),
    encodeField(FIELD.MCP_TOOL_SERVER, WIRE_TYPE.LEN, 'custom'),
  )
}

// ==================== 请求构建 ====================

export function encodeRequest(
  messages: CursorInputMessage[],
  modelName: string,
  tools: CursorToolDef[] = [],
  reasoningEffort: string | null = null,
  forceAgentMode = false,
  deps: CursorEncodeDeps = {},
): Uint8Array {
  const genId = deps.genId ?? randomUUID
  const now = deps.now ?? Date.now

  const hasTools = tools?.length > 0
  const isAgentic = hasTools || forceAgentMode
  const formattedMessages: Array<{
    content: string
    role: number
    messageId: string
    isLast: boolean
    hasTools: boolean
    toolResults: CursorToolResult[]
  }> = []
  const messageIds: Array<{ messageId: string; role: number }> = []
  const normalizedMessages: CursorInputMessage[] = []

  // 拆分混合的 assistant payload（tool_calls + tool_results 同条）——防 protobuf 编码错误。
  for (let i = 0; i < messages.length; i++) {
    const msg = messages[i]
    const hasToolCalls = Array.isArray(msg?.tool_calls) && msg.tool_calls.length > 0
    const hasToolResults = Array.isArray(msg?.tool_results) && msg.tool_results.length > 0

    if (msg?.role === 'assistant' && hasToolCalls && hasToolResults) {
      normalizedMessages.push({ ...msg, tool_results: [] })

      const nextMsg = messages[i + 1]
      const nextHasToolResults =
        nextMsg?.role === 'assistant' &&
        Array.isArray(nextMsg?.tool_results) &&
        (nextMsg.tool_results as CursorToolResult[]).length > 0
      const currentIds = new Set(
        (msg.tool_results ?? [])
          .map((tr) => tr?.tool_call_id)
          .filter((id): id is string => typeof id === 'string'),
      )
      const nextIds = new Set(
        (nextMsg?.tool_results || [])
          .map((tr) => tr?.tool_call_id)
          .filter((id): id is string => typeof id === 'string'),
      )
      let sameIds = currentIds.size > 0 && currentIds.size === nextIds.size
      if (sameIds) {
        for (const id of currentIds) {
          if (!nextIds.has(id)) {
            sameIds = false
            break
          }
        }
      }

      if (!(nextHasToolResults && sameIds)) {
        normalizedMessages.push({
          role: 'assistant',
          content: '',
          tool_results: msg.tool_results ?? [],
        })
      }

      continue
    }

    normalizedMessages.push(msg)
  }

  for (let i = 0; i < normalizedMessages.length; i++) {
    const msg = normalizedMessages[i]
    const role = msg.role === 'user' ? ROLE.USER : ROLE.ASSISTANT
    const msgId = genId()
    const isLast = i === normalizedMessages.length - 1

    formattedMessages.push({
      content: msg.content,
      role,
      messageId: msgId,
      isLast,
      hasTools,
      toolResults: msg.tool_results || [],
    })

    messageIds.push({ messageId: msgId, role })
  }

  let thinkingLevel: number = THINKING_LEVEL.UNSPECIFIED
  if (reasoningEffort === 'medium') thinkingLevel = THINKING_LEVEL.MEDIUM
  else if (reasoningEffort === 'high') thinkingLevel = THINKING_LEVEL.HIGH

  return concatArrays(
    ...formattedMessages.map((fm) =>
      encodeField(
        FIELD.MESSAGES,
        WIRE_TYPE.LEN,
        encodeMessage(fm.content, fm.role, fm.messageId, null, fm.isLast, fm.hasTools, fm.toolResults),
      ),
    ),

    encodeField(FIELD.UNKNOWN_2, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.INSTRUCTION, WIRE_TYPE.LEN, encodeInstruction('')),
    encodeField(FIELD.UNKNOWN_4, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.MODEL, WIRE_TYPE.LEN, encodeModel(modelName)),
    encodeField(FIELD.WEB_TOOL, WIRE_TYPE.LEN, ''),
    encodeField(FIELD.UNKNOWN_13, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.CURSOR_SETTING, WIRE_TYPE.LEN, encodeCursorSetting()),
    encodeField(FIELD.UNKNOWN_19, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.CONVERSATION_ID, WIRE_TYPE.LEN, genId()),
    encodeField(FIELD.METADATA, WIRE_TYPE.LEN, encodeMetadata(now)),

    encodeField(FIELD.IS_AGENTIC, WIRE_TYPE.VARINT, isAgentic ? 1 : 0),
    ...(isAgentic ? [encodeField(FIELD.SUPPORTED_TOOLS, WIRE_TYPE.LEN, encodeVarint(1))] : []),

    ...messageIds.map((mid) =>
      encodeField(FIELD.MESSAGE_IDS, WIRE_TYPE.LEN, encodeMessageId(mid.messageId, mid.role)),
    ),

    ...(tools?.length > 0
      ? tools.map((tool) => encodeField(FIELD.MCP_TOOLS, WIRE_TYPE.LEN, encodeMcpTool(tool)))
      : []),

    encodeField(FIELD.LARGE_CONTEXT, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNKNOWN_38, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNIFIED_MODE, WIRE_TYPE.VARINT, isAgentic ? UNIFIED_MODE.AGENT : UNIFIED_MODE.CHAT),
    encodeField(FIELD.UNKNOWN_47, WIRE_TYPE.LEN, ''),
    encodeField(FIELD.SHOULD_DISABLE_TOOLS, WIRE_TYPE.VARINT, isAgentic ? 0 : 1),
    encodeField(FIELD.THINKING_LEVEL, WIRE_TYPE.VARINT, thinkingLevel),
    encodeField(FIELD.UNKNOWN_51, WIRE_TYPE.VARINT, 0),
    encodeField(FIELD.UNKNOWN_53, WIRE_TYPE.VARINT, 1),
    encodeField(FIELD.UNIFIED_MODE_NAME, WIRE_TYPE.LEN, isAgentic ? 'Agent' : 'Ask'),
  )
}

export function buildChatRequest(
  messages: CursorInputMessage[],
  modelName: string,
  tools: CursorToolDef[] = [],
  reasoningEffort: string | null = null,
  forceAgentMode = false,
  deps: CursorEncodeDeps = {},
): Uint8Array {
  return encodeField(
    FIELD.REQUEST,
    WIRE_TYPE.LEN,
    encodeRequest(messages, modelName, tools, reasoningEffort, forceAgentMode, deps),
  )
}

export function wrapConnectRPCFrame(payload: Uint8Array, compress = false): Uint8Array {
  let finalPayload = payload
  let flags = 0x00

  if (compress) {
    finalPayload = new Uint8Array(zlib.gzipSync(Buffer.from(payload)))
    flags = 0x01
  }

  const frame = new Uint8Array(5 + finalPayload.length)
  frame[0] = flags
  frame[1] = (finalPayload.length >> 24) & 0xff
  frame[2] = (finalPayload.length >> 16) & 0xff
  frame[3] = (finalPayload.length >> 8) & 0xff
  frame[4] = finalPayload.length & 0xff
  frame.set(finalPayload, 5)

  return frame
}

export function generateCursorBody(
  messages: CursorInputMessage[],
  modelName: string,
  tools: CursorToolDef[] = [],
  reasoningEffort: string | null = null,
  forceAgentMode = false,
  deps: CursorEncodeDeps = {},
): Uint8Array {
  const protobuf = buildChatRequest(messages, modelName, tools, reasoningEffort, forceAgentMode, deps)
  // Cursor 不接受压缩请求。
  return wrapConnectRPCFrame(protobuf, false)
}

// ==================== 基础解码 ====================

export function decodeVarint(buffer: Uint8Array, offset: number): [number, number] {
  let result = 0
  let shift = 0
  let pos = offset

  while (pos < buffer.length) {
    const b = buffer[pos]
    result |= (b & 0x7f) << shift
    pos++
    if (!(b & 0x80)) break
    shift += 7
  }

  return [result, pos]
}

export function decodeField(
  buffer: Uint8Array,
  offset: number,
): [number | null, number | null, Uint8Array | number | null, number] {
  if (offset >= buffer.length) return [null, null, null, offset]

  const [tag, pos1] = decodeVarint(buffer, offset)
  const fieldNum = tag >> 3
  const wireType = tag & 0x07

  let value: Uint8Array | number | null
  let pos = pos1

  if (wireType === WIRE_TYPE.VARINT) {
    ;[value, pos] = decodeVarint(buffer, pos)
  } else if (wireType === WIRE_TYPE.LEN) {
    const [length, pos2] = decodeVarint(buffer, pos)
    value = buffer.slice(pos2, pos2 + length)
    pos = pos2 + length
  } else if (wireType === WIRE_TYPE.FIXED64) {
    value = buffer.slice(pos, pos + 8)
    pos += 8
  } else if (wireType === WIRE_TYPE.FIXED32) {
    value = buffer.slice(pos, pos + 4)
    pos += 4
  } else {
    value = null
  }

  return [fieldNum, wireType, value, pos]
}

export interface DecodedField {
  wireType: number
  value: Uint8Array | number | null
}

export function decodeMessage(data: Uint8Array): Map<number, DecodedField[]> {
  const fields = new Map<number, DecodedField[]>()
  let pos = 0

  while (pos < data.length) {
    const [fieldNum, wireType, value, newPos] = decodeField(data, pos)
    if (fieldNum === null) break

    if (!fields.has(fieldNum)) fields.set(fieldNum, [])
    fields.get(fieldNum)!.push({ wireType: wireType as number, value })
    pos = newPos
  }

  return fields
}

// ==================== 响应解析 ====================

export interface ParsedFrame {
  flags: number
  length: number
  payload: Uint8Array
  consumed: number
}

export function parseConnectRPCFrame(buffer: Uint8Array): ParsedFrame | null {
  if (buffer.length < 5) return null

  const flags = buffer[0]
  const length = (buffer[1] << 24) | (buffer[2] << 16) | (buffer[3] << 8) | buffer[4]

  if (buffer.length < 5 + length) return null

  let payload = buffer.slice(5, 5 + length)

  if (flags === 0x01) {
    try {
      payload = new Uint8Array(zlib.gunzipSync(Buffer.from(payload)))
    } catch {
      // 解压失败：原样返回。
    }
  }

  return { flags, length, payload, consumed: 5 + length }
}

export interface CursorToolCall {
  id: string
  type: 'function'
  function: { name: string; arguments: string }
  isLast: boolean
}

function extractToolCall(toolCallData: Uint8Array): CursorToolCall | null {
  const toolCall = decodeMessage(toolCallData)
  let toolCallId = ''
  let toolName = ''
  let rawArgs = ''
  let isLast = false

  if (toolCall.has(FIELD.TOOL_ID)) {
    const fullId = textDecoder.decode(toolCall.get(FIELD.TOOL_ID)![0].value as Uint8Array)
    toolCallId = fullId.split('\n')[0]
  }

  if (toolCall.has(FIELD.TOOL_NAME)) {
    toolName = textDecoder.decode(toolCall.get(FIELD.TOOL_NAME)![0].value as Uint8Array)
  }

  if (toolCall.has(FIELD.TOOL_IS_LAST)) {
    isLast = (toolCall.get(FIELD.TOOL_IS_LAST)![0].value as number) !== 0
  }

  if (toolCall.has(FIELD.TOOL_MCP_PARAMS)) {
    try {
      const mcpParams = decodeMessage(toolCall.get(FIELD.TOOL_MCP_PARAMS)![0].value as Uint8Array)

      if (mcpParams.has(FIELD.MCP_TOOLS_LIST)) {
        const tool = decodeMessage(mcpParams.get(FIELD.MCP_TOOLS_LIST)![0].value as Uint8Array)

        if (tool.has(FIELD.MCP_NESTED_NAME)) {
          toolName = textDecoder.decode(tool.get(FIELD.MCP_NESTED_NAME)![0].value as Uint8Array)
        }

        if (tool.has(FIELD.MCP_NESTED_PARAMS)) {
          rawArgs = textDecoder.decode(tool.get(FIELD.MCP_NESTED_PARAMS)![0].value as Uint8Array)
        }
      }
    } catch {
      // MCP 解析失败：忽略。
    }
  }

  if (!rawArgs && toolCall.has(FIELD.TOOL_RAW_ARGS)) {
    rawArgs = textDecoder.decode(toolCall.get(FIELD.TOOL_RAW_ARGS)![0].value as Uint8Array)
  }

  if (toolCallId && toolName) {
    return {
      id: toolCallId,
      type: 'function',
      function: {
        name: toolName,
        arguments: rawArgs || '{}',
      },
      isLast,
    }
  }

  return null
}

function extractTextAndThinking(responseData: Uint8Array): { text: string | null; thinking: string | null } {
  const nested = decodeMessage(responseData)
  let text: string | null = null
  let thinking: string | null = null

  if (nested.has(FIELD.RESPONSE_TEXT)) {
    text = textDecoder.decode(nested.get(FIELD.RESPONSE_TEXT)![0].value as Uint8Array)
  }

  if (nested.has(FIELD.THINKING)) {
    try {
      const thinkingMsg = decodeMessage(nested.get(FIELD.THINKING)![0].value as Uint8Array)
      if (thinkingMsg.has(FIELD.THINKING_TEXT)) {
        thinking = textDecoder.decode(thinkingMsg.get(FIELD.THINKING_TEXT)![0].value as Uint8Array)
      }
    } catch {
      // thinking 解析失败：忽略。
    }
  }

  return { text, thinking }
}

export interface ExtractedResponse {
  text: string | null
  error: string | null
  toolCall: CursorToolCall | null
  thinking: string | null
  raw?: string
  decodeError?: string
}

export function extractTextFromResponse(payload: Uint8Array): ExtractedResponse {
  try {
    const fields = decodeMessage(payload)

    for (const fieldNum of fields.keys()) {
      if (!KNOWN_RESPONSE_FIELDS.has(fieldNum)) {
        // 未知字段：可能是 Cursor 协议更新（schema 版本过时），此处静默（真机日志侧另行告警）。
      }
    }

    if (fields.has(FIELD.TOOL_CALL)) {
      const toolCall = extractToolCall(fields.get(FIELD.TOOL_CALL)![0].value as Uint8Array)
      if (toolCall) {
        return { text: null, error: null, toolCall, thinking: null }
      }
    }

    if (fields.has(FIELD.RESPONSE)) {
      const { text, thinking } = extractTextAndThinking(fields.get(FIELD.RESPONSE)![0].value as Uint8Array)

      if (text || thinking) {
        return { text, error: null, toolCall: null, thinking }
      }
    }

    return { text: null, error: null, toolCall: null, thinking: null }
  } catch (err) {
    return {
      text: null,
      error: null,
      toolCall: null,
      thinking: null,
      raw: Buffer.from(payload).toString('base64'),
      decodeError: (err as Error).message,
    }
  }
}
