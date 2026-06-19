/**
 * MikroORM 实体：routing_events（路由日志重构后的统一明细表，取代 routing_request_logs）。
 * 每条反代请求一行，由 RoutingObservabilityService 批量落库。
 *
 * - tsSec 为 tsMs 的秒级投影（窗口过滤索引）。
 * - stream/ok 以 0/1 存（SQLite 动态类型）；route_path 以 JSON 数组文本存。
 * - 相对旧 routing_request_logs 新增列（error_kind/ttfb_ms/upstream_ms/upstream_endpoint/
 *   proxy_id/req_bytes/resp_bytes/client_ip/user_agent）。error_kind 非空（'none' 表成功）；
 *   其余新列 nullable。
 * - 索引覆盖窗口过滤、下钻（platform/account/status）与 keyset 分页 (ts_ms,id)。
 */
import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

@Entity({ tableName: 'routing_events' })
@Index({ properties: ['tsSec'] })
@Index({ properties: ['tsSec', 'ok'] })
@Index({ properties: ['tsSec', 'platform'] })
@Index({ properties: ['tsSec', 'accountId'] })
@Index({ properties: ['tsSec', 'status'] })
@Index({ properties: ['tsMs', 'id'] })
export class RoutingEventEntity {
  @PrimaryKey({ type: 'integer', autoincrement: true })
  id!: number

  @Property({ type: 'integer' })
  seq!: number

  @Property({ type: 'bigint', fieldName: 'ts_ms' })
  tsMs!: number

  /** tsMs 的秒级投影（窗口过滤索引）。 */
  @Property({ type: 'bigint', fieldName: 'ts_sec' })
  tsSec!: number

  @Property({ type: 'text' })
  method!: string

  @Property({ type: 'text' })
  path!: string

  @Property({ type: 'text' })
  format!: string

  @Property({ type: 'text', nullable: true })
  platform?: string

  @Property({ type: 'text' })
  action!: string

  @Property({ type: 'boolean' })
  stream!: boolean

  @Property({ type: 'integer' })
  status!: number

  @Property({ type: 'boolean' })
  ok!: boolean

  /** 错误分类（成功为 'none'）。 */
  @Property({ type: 'text', fieldName: 'error_kind' })
  errorKind!: string

  @Property({ type: 'text', fieldName: 'error_message', nullable: true })
  errorMessage?: string

  @Property({ type: 'integer', fieldName: 'duration_ms' })
  durationMs!: number

  @Property({ type: 'integer', fieldName: 'ttfb_ms', nullable: true })
  ttfbMs?: number

  @Property({ type: 'integer', fieldName: 'upstream_ms', nullable: true })
  upstreamMs?: number

  @Property({ type: 'integer' })
  attempts!: number

  @Property({ type: 'integer', fieldName: 'route_hops', nullable: true })
  routeHops?: number

  /** 降级链路径，JSON 数组文本（如 ["kr/claude-sonnet-4.5","relay-x/deepseek"]）。 */
  @Property({ type: 'text', fieldName: 'route_path', nullable: true })
  routePath?: string

  @Property({ type: 'text', fieldName: 'combo_name', nullable: true })
  comboName?: string

  @Property({ type: 'text', fieldName: 'requested_model', nullable: true })
  requestedModel?: string

  @Property({ type: 'text', fieldName: 'final_model', nullable: true })
  finalModel?: string

  @Property({ type: 'text', fieldName: 'account_id', nullable: true })
  accountId?: string

  @Property({ type: 'text', fieldName: 'client_key_id', nullable: true })
  clientKeyId?: string

  @Property({ type: 'text', fieldName: 'upstream_endpoint', nullable: true })
  upstreamEndpoint?: string

  @Property({ type: 'text', fieldName: 'proxy_id', nullable: true })
  proxyId?: string

  @Property({ type: 'integer', fieldName: 'input_tokens', nullable: true })
  inputTokens?: number

  @Property({ type: 'integer', fieldName: 'output_tokens', nullable: true })
  outputTokens?: number

  @Property({ type: 'integer', fieldName: 'cache_read_tokens', nullable: true })
  cacheReadTokens?: number

  @Property({ type: 'integer', fieldName: 'cache_write_tokens', nullable: true })
  cacheWriteTokens?: number

  @Property({ type: 'integer', fieldName: 'req_bytes', nullable: true })
  reqBytes?: number

  @Property({ type: 'integer', fieldName: 'resp_bytes', nullable: true })
  respBytes?: number

  @Property({ type: 'text', fieldName: 'client_ip', nullable: true })
  clientIp?: string

  @Property({ type: 'text', fieldName: 'user_agent', nullable: true })
  userAgent?: string
}
