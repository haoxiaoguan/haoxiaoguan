import type { IncomingMessage, ServerResponse } from 'node:http'
import { Hono } from 'hono'
import { getRequestListener } from '@hono/node-server'

// M1 的最小 Hono app：仅一个健康检查端点。M2+ 在此挂中间件链与各协议路由
// （见 spec §5/§6），M1 严格只保留 /health。
export function createHonoApp(): Hono {
  const app = new Hono()
  app.get('/health', (c) => c.json({ ok: true }))
  return app
}

// 把 Hono app 适配成 ApiHttpServer 需要的 node 风格 handler。
// getRequestListener 由 @hono/node-server 提供，将 Web Fetch handler(app.fetch)
// 转成 (req, res) => void，无需动态 import、与 externalize/CJS 兼容。
export function createApiRequestListener(): (req: IncomingMessage, res: ServerResponse) => void {
  return getRequestListener(createHonoApp().fetch)
}
