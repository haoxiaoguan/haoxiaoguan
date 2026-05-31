// ModelQuota / QuotaInfo — legacy per-model quota aggregate.
//
// 对应 modules/quota/domain/quota.rs. ModelQuota.usagePercentage() =
// (used*100)/total (integer, 0 when total==0). isWarning() = usagePercentage >= 90.
// QuotaInfo is the legacy aggregate persisted in quota_cache; empty models means
// "no data" and is not persisted.

export class ModelQuota {
  readonly modelName: string
  readonly used: number
  readonly total: number
  readonly resetAt?: Date

  constructor(modelName: string, used: number, total: number, resetAt?: Date) {
    this.modelName = modelName
    this.used = used
    this.total = total
    this.resetAt = resetAt
  }

  /** Integer usage percentage (0-…). Returns 0 if total==0. Source usage_percentage. */
  usagePercentage(): number {
    if (this.total === 0) return 0
    return Math.trunc((this.used * 100) / this.total)
  }

  /** True if usagePercentage >= 90. Source is_warning. */
  isWarning(): boolean {
    return this.usagePercentage() >= 90
  }
}

export class QuotaInfo {
  readonly accountId: string
  readonly models: ModelQuota[]
  readonly fetchedAt: Date

  constructor(accountId: string, models: ModelQuota[], fetchedAt: Date) {
    this.accountId = accountId
    this.models = models
    this.fetchedAt = fetchedAt
  }
}
