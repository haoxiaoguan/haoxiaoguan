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

export function estimateRequestInputTokens(req: CanonicalRequest): number {
  let total = 0
  if (req.system !== undefined) total += countTextTokens(req.system)
  for (const msg of req.messages) {
    for (const block of msg.content) total += countTextTokens(blockText(block))
  }
  if (req.tools !== undefined) {
    for (const t of req.tools) {
      total += countTextTokens(t.name)
      if (t.description !== undefined) total += countTextTokens(t.description)
      total += countTextTokens(JSON.stringify(t.inputSchema))
    }
  }
  return Math.max(total, 1)
}
