import { describe, it, expect } from 'vitest'
import { createHonoApp } from '../../../src/main/contexts/apiProxy/infrastructure/http/hono-app'

describe('createHonoApp', () => {
  it('GET /health returns 200 and { ok: true }', async () => {
    const app = createHonoApp()
    const res = await app.request('/health')
    expect(res.status).toBe(200)
    expect(await res.json()).toEqual({ ok: true })
  })

  it('unknown route returns 404', async () => {
    const app = createHonoApp()
    const res = await app.request('/does-not-exist')
    expect(res.status).toBe(404)
  })
})
