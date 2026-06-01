// Proxy import-line parser. Tolerant of blank/comment lines; supports two
// textual formats used by proxy vendors:
//   1. host:port  or  host:port:user:pass   (colon-delimited; password may
//      itself contain colons — everything after the 3rd colon is the password)
//   2. scheme://user:pass@host:port          (URL form; scheme ∈ http/https/socks5)
//
// Bad lines never throw — they are collected into `failed` with a reason so the
// importer can summarise "N ok / M failed".

import { isProxyProtocol, type ProxyProtocol } from './proxy'

export interface ParsedProxyLine {
  protocol: ProxyProtocol
  host: string
  port: number
  username?: string
  password?: string
}

export type ParseLineResult =
  | { ok: true; value: ParsedProxyLine }
  | { ok: false; error: string }

export interface FailedLine {
  lineNumber: number
  raw: string
  error: string
}

export interface ParseLinesResult {
  parsed: ParsedProxyLine[]
  failed: FailedLine[]
}

function parsePort(text: string): number | undefined {
  if (!/^\d+$/.test(text)) return undefined
  const port = Number.parseInt(text, 10)
  if (port < 1 || port > 65535) return undefined
  return port
}

function parseUrlForm(line: string): ParseLineResult {
  // scheme://[user:pass@]host:port
  const match = /^([a-z0-9]+):\/\/(?:([^:@/]+)(?::([^@/]*))?@)?([^:/@]+):(\d+)$/i.exec(line)
  if (match === null) return { ok: false, error: 'malformed url-form proxy' }
  const [, scheme, user, pass, host, portText] = match
  const protocol = scheme.toLowerCase()
  if (!isProxyProtocol(protocol)) return { ok: false, error: `unsupported scheme: ${scheme}` }
  const port = parsePort(portText)
  if (port === undefined) return { ok: false, error: `invalid port: ${portText}` }
  return {
    ok: true,
    value: {
      protocol,
      host,
      port,
      username: user === '' ? undefined : user,
      password: user === undefined || user === '' ? undefined : pass ?? '',
    },
  }
}

function parseColonForm(line: string): ParseLineResult {
  // host:port  or  host:port:user:pass  (password may contain further colons)
  const parts = line.split(':')
  if (parts.length < 2) return { ok: false, error: 'expected host:port' }
  const [host, portText, user, ...passRest] = parts
  if (host === '') return { ok: false, error: 'empty host' }
  const port = parsePort(portText)
  if (port === undefined) return { ok: false, error: `invalid port: ${portText}` }
  if (user === undefined) {
    return { ok: true, value: { protocol: 'http', host, port } }
  }
  const password = passRest.length > 0 ? passRest.join(':') : ''
  return {
    ok: true,
    value: { protocol: 'http', host, port, username: user, password },
  }
}

export function parseProxyLine(line: string): ParseLineResult {
  const trimmed = line.trim()
  if (trimmed === '') return { ok: false, error: 'empty line' }
  return trimmed.includes('://') ? parseUrlForm(trimmed) : parseColonForm(trimmed)
}

function isSkippable(line: string): boolean {
  const t = line.trim()
  return t === '' || t.startsWith('#') || t.startsWith('//')
}

export function parseProxyLines(text: string): ParseLinesResult {
  const parsed: ParsedProxyLine[] = []
  const failed: FailedLine[] = []
  const lines = text.split(/\r?\n/)
  for (let i = 0; i < lines.length; i++) {
    const raw = lines[i]
    if (isSkippable(raw)) continue
    const result = parseProxyLine(raw)
    if (result.ok) parsed.push(result.value)
    else failed.push({ lineNumber: i + 1, raw: raw.trim(), error: result.error })
  }
  return { parsed, failed }
}
