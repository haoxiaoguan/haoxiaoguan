// src/main/contexts/activity/application/activity-query-service.ts
import type { ActivityRepository, ActivityTrendPoint } from '../domain/activity-repository'

export class ActivityQueryService {
  constructor(private readonly repo: ActivityRepository) {}

  trend(range: string, metric: string): Promise<ActivityTrendPoint[]> {
    return this.repo.trend(range, metric)
  }
}
