// token 估算（纯函数）。优先官方 tokenizer，失败降级字符分类（中文友好）。
/* eslint-disable @typescript-eslint/no-require-imports */
import type { CanonicalRequest, ContentBlock } from '../canonical'

// 字符分类加权估算：ascii÷4.5、数字÷2、符号÷1.5、非 ASCII÷1.5。
function approxTokens(text: string): number {
  if (text.length === 0) return 0
  let ascii = 0
  let digit = 0
  let symbol = 0
  let nonAscii = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    if (c >= 0x80) nonAscii++
    else if (c >= 0x30 && c <= 0x39) digit++
    else if ((c >= 0x21 && c <= 0x2f) || (c >= 0x3a && c <= 0x40) || (c >= 0x5b && c <= 0x60) || (c >= 0x7b && c <= 0x7e)) symbol++
    else ascii++
  }
  const est = Math.ceil(ascii / 4.5 + digit / 2 + symbol / 1.5 + nonAscii / 1.5)
  return Math.max(est, 1)
}

// 官方 tokenizer（静态 require，bytecode 友好；不可用时返回 null 降级）。
type CountFn = (t: string) => number
let officialCounter: CountFn | null | undefined
function getOfficial(): CountFn | null {
  if (officialCounter !== undefined) return officialCounter
  try {
    const mod = require('@anthropic-ai/tokenizer') as { countTokens?: CountFn }
    officialCounter = typeof mod.countTokens === 'function' ? mod.countTokens : null
  } catch {
    officialCounter = null
  }
  return officialCounter
}

// 查询官方 tokenizer 是否可用（复用模块级缓存，不产生副作用）。
export function isOfficialTokenizerAvailable(): boolean {
  return getOfficial() !== null
}

export function countTextTokens(text: string): number {
  if (text.length === 0) return 0
  const official = getOfficial()
  if (official !== null) {
    try {
      const n = official(text)
      if (Number.isFinite(n) && n >= 0) return n
    } catch {
      // 落到字符分类
    }
  }
  return approxTokens(text)
}

function blockText(block: ContentBlock): string {
  if (block.type === 'text') return block.text
  if (block.type === 'thinking') return block.text
  if (block.type === 'tool_use') return `${block.name} ${JSON.stringify(block.input)}`
  if (block.type === 'tool_result') return block.content.map((c) => (c.type === 'text' ? c.text : '')).join(' ')
  return ''
}

/**
 * 估算请求输入 token。
 *
 * ⚠️ 刻意走**字符分类近似**（approxTokens），不走官方 BPE tokenizer：
 * 本函数在代理热路径上对**每个请求**同步调用（api-proxy-service handleMessages/handleResponses），
 * 火山方舟/GLM 等大上下文请求 input 可达数十万 token，官方 tokenizer 同步 BPE 编码整段请求会
 * 阻塞 Electron 主进程上百毫秒 → 整个 app 卡顿。而此处估值仅作"上游未回传 usage 时的兜底"，
 * 成功请求会被上游真实 usage 覆盖；且对非 Claude 上游，Claude BPE 估值本就不准。故用 O(n)
 * 字符近似（中文友好、无 WASM、无逐块调用开销），既快又够用。
 */
export function estimateRequestInputTokens(req: CanonicalRequest): number {
  let total = 0
  if (req.system !== undefined) total += approxTokens(req.system)
  for (const msg of req.messages) {
    for (const block of msg.content) total += approxTokens(blockText(block))
  }
  if (req.tools !== undefined) {
    for (const t of req.tools) {
      total += approxTokens(t.name)
      if (t.description !== undefined) total += approxTokens(t.description)
      total += approxTokens(JSON.stringify(t.inputSchema))
    }
  }
  return Math.max(total, 1)
}
