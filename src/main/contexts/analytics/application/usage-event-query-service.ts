/**
 * UsageEventQueryService —— 读路径：透传仓储的聚合查询。
 * 只读 usage_events 单表，不碰 routing_events / usage_records。
 */
import type { MikroOrmUsageEventRepository } from '../infrastructure/mikro-orm-usage-event-repository'
import type {
  UsageEventWindow,
  UsageEventGranularity,
  UsageEventTrendMetric,
  UsageEventSummary,
  UsageEventTrendPoint,
  AgentBreakdownRow,
  ModelBreakdownRow,
  UsageEventSearchFilter,
  UsageEventCursor,
  UsageEventSearchPage,
} from '../domain/usage-event'

export class UsageEventQueryService {
  constructor(private readonly eventRepo: MikroOrmUsageEventRepository) {}

  async summary(window: UsageEventWindow, agentId?: string): Promise<UsageEventSummary> {
    return this.eventRepo.summary(window, agentId)
  }

  async trend(
    window: UsageEventWindow,
    granularity: UsageEventGranularity,
    metric: UsageEventTrendMetric,
    agentId?: string,
  ): Promise<UsageEventTrendPoint[]> {
    return this.eventRepo.trend(window, granularity, metric, agentId)
  }

  async agentBreakdown(window: UsageEventWindow): Promise<AgentBreakdownRow[]> {
    return this.eventRepo.agentBreakdown(window)
  }

  async modelBreakdown(window: UsageEventWindow, agentId?: string): Promise<ModelBreakdownRow[]> {
    return this.eventRepo.modelBreakdown(window, agentId)
  }

  async search(
    window: UsageEventWindow,
    filter: UsageEventSearchFilter,
    cursor: UsageEventCursor | undefined,
    limit?: number,
  ): Promise<UsageEventSearchPage> {
    return this.eventRepo.search(window, filter, cursor, limit)
  }
}
