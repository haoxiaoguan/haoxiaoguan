// src/main/contexts/activity/application/activity-query-service.ts
import type {
  ActivityGranularity,
  ActivityRepository,
  ActivityTrendPoint,
  ActivityWindow,
} from '../domain/activity-repository'

export class ActivityQueryService {
  constructor(private readonly repo: ActivityRepository) {}

  trend(
    window: ActivityWindow,
    granularity: ActivityGranularity,
    metric: string,
  ): Promise<ActivityTrendPoint[]> {
    return this.repo.trend(window, granularity, metric)
  }
}
