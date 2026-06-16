#!/usr/bin/env node
// 反代高并发压测脚本（零依赖，Node ESM）。
//
// 对运行中的本地反代发起 N 路并发 × 共 M 请求，统计成功率/状态码分布/时延分位/
// 402(额度耗尽)·429(限速) 计数，并在压测前后采样 /metrics 对比账号池运行态变化。
//
// 用法（全部可用环境变量覆盖）：
//   BASE=http://127.0.0.1:28788 \
//   FORMAT=anthropic            # anthropic | openai
//   MODEL=claude-sonnet-4.5     \
//   CONC=5 TOTAL=20 MAXTOK=16   \
//   KEY=<client key，可选；loopback 允许匿名时不需要> \
//   PROMPT="hi" TIMEOUT_MS=120000 \
//   node scripts/proxy-load-test.mjs
//
// 退出码：0=全部成功；1=有失败；2=连不上反代。

const BASE = (process.env.BASE ?? 'http://127.0.0.1:28788').replace(/\/$/, '')
const FORMAT = (process.env.FORMAT ?? 'anthropic').toLowerCase()
const MODEL = process.env.MODEL ?? 'claude-sonnet-4.5'
const CONC = Math.max(1, parseInt(process.env.CONC ?? '5', 10))
const TOTAL = Math.max(1, parseInt(process.env.TOTAL ?? '20', 10))
const MAXTOK = Math.max(1, parseInt(process.env.MAXTOK ?? '16', 10))
const KEY = process.env.KEY ?? ''
const PROMPT = process.env.PROMPT ?? 'Reply with the single word: ok'
const TIMEOUT_MS = Math.max(1000, parseInt(process.env.TIMEOUT_MS ?? '120000', 10))
const STREAM = /^(1|true|yes)$/i.test(process.env.STREAM ?? '')

function authHeaders() {
  const h = { 'content-type': 'application/json' }
  if (KEY) {
    if (FORMAT === 'anthropic') h['x-api-key'] = KEY
    else h['authorization'] = `Bearer ${KEY}`
  }
  if (FORMAT === 'anthropic') h['anthropic-version'] = '2023-06-01'
  return h
}

function endpointAndBody() {
  if (FORMAT === 'openai') {
    return {
      url: `${BASE}/v1/chat/completions`,
      body: {
        model: MODEL,
        max_tokens: MAXTOK,
        stream: STREAM,
        messages: [{ role: 'user', content: PROMPT }],
      },
    }
  }
  return {
    url: `${BASE}/v1/messages`,
    body: {
      model: MODEL,
      max_tokens: MAXTOK,
      stream: STREAM,
      messages: [{ role: 'user', content: PROMPT }],
    },
  }
}

async function fetchMetrics() {
  try {
    const r = await fetch(`${BASE}/metrics`, { signal: AbortSignal.timeout(5000) })
    if (!r.ok) return null
    const text = await r.text()
    const out = { accounts: {}, requests: {} }
    for (const line of text.split('\n')) {
      let m = line.match(/^apiproxy_accounts\{state="(\w+)"\}\s+(\d+)/)
      if (m) out.accounts[m[1]] = Number(m[2])
      m = line.match(/^apiproxy_requests_(\w+)\s+(\d+)/)
      if (m) out.requests[m[1]] = Number(m[2])
      m = line.match(/^apiproxy_(inflight_requests)\s+(\d+)/)
      if (m) out.requests[m[1]] = Number(m[2])
    }
    return out
  } catch {
    return null
  }
}

async function oneRequest(i) {
  const { url, body } = endpointAndBody()
  const t0 = performance.now()
  try {
    const r = await fetch(url, {
      method: 'POST',
      headers: authHeaders(),
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // 读完响应体确保完整往返（流式则 drain）。
    const text = await r.text()
    const ms = performance.now() - t0
    let errSnippet
    if (!r.ok) errSnippet = text.slice(0, 200).replace(/\s+/g, ' ')
    return { i, status: r.status, ok: r.ok, ms, bytes: text.length, errSnippet }
  } catch (e) {
    const ms = performance.now() - t0
    return { i, status: 0, ok: false, ms, bytes: 0, errSnippet: String(e?.message ?? e).slice(0, 200) }
  }
}

function pct(sorted, p) {
  if (sorted.length === 0) return 0
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))
  return sorted[idx]
}

async function main() {
  // 预检：反代是否在线。
  const health = await fetch(`${BASE}/health`, { signal: AbortSignal.timeout(4000) }).catch(() => null)
  if (!health || !health.ok) {
    console.error(`[load-test] 反代不可用：${BASE}/health 无响应。请先启动 App 并开启反代。`)
    process.exit(2)
  }

  const before = await fetchMetrics()
  console.log(
    `[load-test] BASE=${BASE} FORMAT=${FORMAT} MODEL=${MODEL} CONC=${CONC} TOTAL=${TOTAL} MAXTOK=${MAXTOK} STREAM=${STREAM} KEY=${KEY ? 'set' : '(none, loopback)'}`,
  )
  if (before) console.log('[load-test] 压测前账号态:', JSON.stringify(before.accounts), '请求计数:', JSON.stringify(before.requests))

  const results = []
  let next = 0
  const wallT0 = performance.now()
  async function worker() {
    while (true) {
      const i = next++
      if (i >= TOTAL) return
      results.push(await oneRequest(i))
    }
  }
  await Promise.all(Array.from({ length: CONC }, () => worker()))
  const wallMs = performance.now() - wallT0

  const after = await fetchMetrics()

  // 统计
  const byStatus = {}
  let ok = 0
  const lat = []
  const errSamples = []
  for (const r of results) {
    byStatus[r.status] = (byStatus[r.status] ?? 0) + 1
    if (r.ok) ok++
    lat.push(r.ms)
    if (!r.ok && errSamples.length < 8) errSamples.push(`#${r.i} [${r.status}] ${r.errSnippet}`)
  }
  lat.sort((a, b) => a - b)
  const failed = TOTAL - ok
  const c402 = byStatus['402'] ?? 0
  const c429 = byStatus['429'] ?? 0

  console.log('\n================ 压测结果 ================')
  console.log(`总请求: ${TOTAL}  成功: ${ok}  失败: ${failed}  成功率: ${((ok / TOTAL) * 100).toFixed(1)}%`)
  console.log(`耗时: ${(wallMs / 1000).toFixed(2)}s  吞吐: ${(TOTAL / (wallMs / 1000)).toFixed(2)} req/s`)
  console.log(`时延(ms) p50=${pct(lat, 50).toFixed(0)} p95=${pct(lat, 95).toFixed(0)} p99=${pct(lat, 99).toFixed(0)} max=${(lat[lat.length - 1] ?? 0).toFixed(0)}`)
  console.log(`状态码分布: ${JSON.stringify(byStatus)}`)
  console.log(`402(额度耗尽): ${c402}   429(限速): ${c429}`)
  if (errSamples.length) {
    console.log('错误样本:')
    for (const s of errSamples) console.log('  - ' + s)
  }
  if (before && after) {
    console.log('\n账号池运行态(前 → 后):')
    const keys = new Set([...Object.keys(before.accounts), ...Object.keys(after.accounts)])
    for (const k of keys) console.log(`  ${k}: ${before.accounts[k] ?? 0} → ${after.accounts[k] ?? 0}`)
    console.log('请求计数(前 → 后):')
    const rk = new Set([...Object.keys(before.requests), ...Object.keys(after.requests)])
    for (const k of rk) console.log(`  ${k}: ${before.requests[k] ?? 0} → ${after.requests[k] ?? 0}`)
  }
  console.log('=========================================\n')

  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error('[load-test] 异常:', e)
  process.exit(2)
})
