// Tauri's invoke rejects with a string. We mirror that: every handler error
// becomes a string message so the renderer's existing catch blocks keep working.
export function toIpcError(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) {
    // 暴露 undici/网络错误的 cause（fetch failed 的真正原因：ECONNREFUSED / TLS / socks 等），
    // 否则被吞成裸 'fetch failed'，无法定位代理/网络问题。
    const cause = (e as { cause?: unknown }).cause
    const causeMsg = cause instanceof Error ? cause.message : typeof cause === 'string' ? cause : undefined
    return causeMsg !== undefined && causeMsg !== e.message ? `${e.message} [cause: ${causeMsg}]` : e.message
  }
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}
