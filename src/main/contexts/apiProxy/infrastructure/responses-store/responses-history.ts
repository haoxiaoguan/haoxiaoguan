// previous_response_id 历史链重建（纯逻辑，loadFn 注入）。
import type { OpenAIMessage } from '../inbound/openai'
import { parseResponsesInput } from '../inbound/responses/responses-input'
import type { ResponseOutputItem } from '../inbound/responses/responses-types'
import type { StoredResponseDoc } from './responses-store'

const MAX_DEPTH = 64

type LoadFn = (id: string) => StoredResponseDoc | null

function outputToMessages(items: ResponseOutputItem[]): OpenAIMessage[] {
  const out: OpenAIMessage[] = []
  for (const item of items) {
    if (item.type === 'message') {
      const text = (item.content ?? []).map((p) => p.text).join('')
      if (text) out.push({ role: 'assistant', content: text })
    } else if (item.type === 'function_call') {
      out.push({
        role: 'assistant',
        content: '',
        tool_calls: [
          {
            id: item.call_id ?? item.id,
            type: 'function',
            function: { name: item.name ?? '', arguments: item.arguments ?? '' },
          },
        ],
      })
    }
  }
  return out
}

function collectChain(prevId: string, loadFn: LoadFn): StoredResponseDoc[] {
  const stack: StoredResponseDoc[] = []
  const visited = new Set<string>()
  let cursor: string | undefined = prevId
  for (let depth = 0; depth < MAX_DEPTH && cursor; depth++) {
    if (visited.has(cursor)) break
    const doc = loadFn(cursor)
    if (doc === null) break
    visited.add(doc.id)
    stack.push(doc)
    cursor = doc.previousResponseId
  }
  return stack.reverse() // oldest-first
}

export function expandPreviousResponseHistory(prevId: string, loadFn: LoadFn): OpenAIMessage[] {
  const chain = collectChain(prevId, loadFn)
  const messages: OpenAIMessage[] = []
  for (const node of chain) {
    if (node.instructions && node.instructions.length > 0) {
      messages.push({ role: 'system', content: node.instructions })
    }
    messages.push(...parseResponsesInput(node.storedInput))
    messages.push(...outputToMessages(node.output))
  }
  return messages
}
