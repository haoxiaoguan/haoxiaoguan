import { randomBytes } from 'node:crypto'

const ALPHABET = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz' // 62
const KEY_LEN = 32

/** 生成客户端 API Key：`sk-hxg-` + 32 字符 base62。rand 可注入便于测试。 */
export function generateClientKey(rand: (n: number) => Buffer = randomBytes): string {
  const bytes = rand(KEY_LEN)
  let out = ''
  for (let i = 0; i < KEY_LEN; i++) out += ALPHABET[bytes[i] % 62]
  return `sk-hxg-${out}`
}
