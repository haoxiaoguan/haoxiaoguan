// Tauri's invoke rejects with a string. We mirror that: every handler error
// becomes a string message so the renderer's existing catch blocks keep working.
export function toIpcError(e: unknown): string {
  if (typeof e === 'string') return e
  if (e instanceof Error) return e.message
  try {
    return JSON.stringify(e)
  } catch {
    return String(e)
  }
}
