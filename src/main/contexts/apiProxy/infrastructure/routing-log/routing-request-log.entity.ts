/**
 * MikroORM 实体：routing_request_logs（路由日志分析模块的明细表）。
 * 每条反代请求一行，由 RoutingLogService 批量落库。tsSec 为 tsMs 的秒级投影，按它索引窗口查询。
 * stream/ok 以 0/1 存（SQLite 动态类型）；routePath 以 JSON 文本存（route_path）。
 */
import { Entity, PrimaryKey, Property, Index } from '@mikro-orm/core'

@Entity({ tableName: 'routing_request_logs' })
@Index({ properties: ['tsSec'] })
@Index({ properties: ['tsSec', 'ok'] })
export class RoutingRequestLogEntity {
  @PrimaryKey({ type: 'integer', autoincrement: true })
  id!: number

  /** ProxyRequestLog 环形缓冲的单调序号（仅参考，不保证跨重启唯一）。 */
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

  @Property({ type: 'integer', fieldName: 'duration_ms' })
  durationMs!: number

  @Property({ type: 'integer' })
  attempts!: number

  @Property({ type: 'text', fieldName: 'account_id', nullable: true })
  accountId?: string

  @Property({ type: 'text', fieldName: 'client_key_id', nullable: true })
  clientKeyId?: string

  @Property({ type: 'text', fieldName: 'combo_name', nullable: true })
  comboName?: string

  @Property({ type: 'text', fieldName: 'requested_model', nullable: true })
  requestedModel?: string

  @Property({ type: 'text', fieldName: 'final_model', nullable: true })
  finalModel?: string

  @Property({ type: 'integer', fieldName: 'route_hops', nullable: true })
  routeHops?: number

  /** 降级链路径，JSON 数组文本（如 ["kr/claude-sonnet-4.5","relay-x/deepseek"]）。 */
  @Property({ type: 'text', fieldName: 'route_path', nullable: true })
  routePath?: string

  @Property({ type: 'integer', fieldName: 'input_tokens', nullable: true })
  inputTokens?: number

  @Property({ type: 'integer', fieldName: 'output_tokens', nullable: true })
  outputTokens?: number

  @Property({ type: 'integer', fieldName: 'cache_read_tokens', nullable: true })
  cacheReadTokens?: number

  @Property({ type: 'integer', fieldName: 'cache_write_tokens', nullable: true })
  cacheWriteTokens?: number

  @Property({ type: 'text', fieldName: 'error_message', nullable: true })
  errorMessage?: string
}
