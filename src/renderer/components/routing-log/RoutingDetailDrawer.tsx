import type { ReactNode } from 'react'
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetDescription } from '@/components/ui/sheet'
import { cn } from '@/lib/utils'
import type { RoutingObsEventDto } from '@shared/api-types'

const p2 = (n: number) => String(n).padStart(2, '0')
const fmtDateTime = (ms: number) => {
  const d = new Date(ms)
  return `${d.getFullYear()}/${p2(d.getMonth() + 1)}/${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}`
}
const fmtMs = (ms?: number) =>
  ms == null ? '—' : ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${Math.round(ms)}ms`
const fmtInt = (n?: number) => (n ?? 0).toLocaleString('en-US')

function Field({ label, value, mono }: { label: string; value: ReactNode; mono?: boolean }) {
  return (
    <div className="flex items-start justify-between gap-3 border-b border-border/40 py-1.5 last:border-0">
      <span className="shrink-0 text-[12px] text-muted-foreground">{label}</span>
      <span className={cn('break-all text-right text-[12px] text-foreground', mono && 'font-mono')}>
        {value}
      </span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="rounded-[10px] border border-border bg-card px-3 py-2">
      <div className="mb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        {title}
      </div>
      {children}
    </div>
  )
}

/** 单请求详情抽屉（点击检索列表行打开）。行数据已完整，无需再查后端。 */
export function RoutingDetailDrawer({
  row,
  onClose,
}: {
  row: RoutingObsEventDto | null
  onClose: () => void
}) {
  return (
    <Sheet
      open={row != null}
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <SheetContent side="right" className="w-[460px] overflow-y-auto sm:max-w-[460px]">
        {row && (
          <>
            <SheetHeader>
              <SheetTitle>请求详情</SheetTitle>
              <SheetDescription>
                seq #{row.seq} · {fmtDateTime(row.tsMs)}
              </SheetDescription>
            </SheetHeader>
            <div className="mt-4 flex flex-col gap-3">
              <Section title="基本">
                <Field
                  label="状态"
                  value={
                    <span
                      className={cn(
                        'rounded-[5px] px-1.5 py-0.5 text-[11px] font-medium tabular-nums',
                        row.ok
                          ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
                          : 'bg-rose-500/10 text-rose-600 dark:text-rose-400',
                      )}
                    >
                      {row.status || 'ERR'}
                      {!row.ok && ` · ${row.errorKind}`}
                    </span>
                  }
                />
                <Field label="方法 / 端点" value={`${row.method} ${row.path}`} mono />
                <Field label="协议" value={row.format} />
                <Field label="动作" value={row.action} />
                <Field label="类型" value={row.stream ? '流式' : '非流式'} />
              </Section>

              <Section title="时间线">
                <Field label="总耗时" value={fmtMs(row.durationMs)} />
                <Field label="首字节 TTFB" value={fmtMs(row.ttfbMs)} />
                <Field label="上游耗时" value={fmtMs(row.upstreamMs)} />
                <Field label="尝试次数" value={String(row.attempts)} />
              </Section>

              <Section title="路由">
                <Field label="平台" value={row.platform ?? '—'} />
                <Field label="组合" value={row.comboName ?? '—'} />
                <Field label="请求模型" value={row.requestedModel ?? '—'} mono />
                <Field label="最终模型" value={row.finalModel ?? '—'} mono />
                <Field label="降级跳数" value={String(row.routeHops ?? 1)} />
                {row.routePath && row.routePath.length > 0 && (
                  <Field
                    label="降级链"
                    value={
                      <span className="flex flex-col items-end gap-0.5">
                        {row.routePath.map((s, i) => (
                          <span key={`${s}-${i}`} className="font-mono">
                            {i + 1}. {s}
                          </span>
                        ))}
                      </span>
                    }
                  />
                )}
              </Section>

              <Section title="账号 / 上游">
                <Field label="账号" value={row.accountId ?? '—'} mono />
                <Field label="客户端 Key" value={row.clientKeyId ?? '匿名'} mono />
                <Field label="上游端点" value={row.upstreamEndpoint ?? '—'} mono />
                <Field label="出站代理" value={row.proxyId ?? '—'} mono />
              </Section>

              <Section title="Token">
                <Field label="输入" value={fmtInt(row.inputTokens)} />
                <Field label="输出" value={fmtInt(row.outputTokens)} />
                <Field label="缓存读" value={fmtInt(row.cacheReadTokens)} />
                <Field label="缓存写" value={fmtInt(row.cacheWriteTokens)} />
              </Section>

              {!row.ok && row.errorMessage && (
                <Section title="错误">
                  <pre className="whitespace-pre-wrap break-all font-mono text-[11px] text-rose-600 dark:text-rose-400">
                    {row.errorMessage}
                  </pre>
                </Section>
              )}
            </div>
          </>
        )}
      </SheetContent>
    </Sheet>
  )
}
