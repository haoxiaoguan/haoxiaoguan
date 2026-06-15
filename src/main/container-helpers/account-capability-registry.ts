// Account capability-registry adapter (quota manifest §5b) — 从 container 抽出。
//
// 账号上下文的 `ProviderCapabilityRegistry` 是更窄、以 account-id 为键的形状，
// 不同于 quota 上下文以凭证/payload 为键的 trait 注册表。此适配器把两者桥接：
// 基于 credential `ValidationService`（信封感知校验）与 quota
// `QuotaApplicationService`（缓存优先额度读取）实现账号接口，替代旧的
// NULL_PROVIDER_REGISTRY 占位。
//
// 说明：`buildCredentialRegistry()` 为 Kiro 注册了真实的 CredentialValidationCapability
// （解密 + 过期/刷新检查）；其它供应商在移植前返回 `unsupported`。因此账号
// 健康/校验经真实服务流转，Kiro 报 valid/expired 而非 unsupported；新增 per-provider
// 校验能力时自动点亮，健康的额度腿（仅在校验为 valid 时到达）经 quota 服务读取。
import type {
  ProviderCapabilityRegistry,
  ValidationCapability,
  QuotaCapability,
  CredentialValidationResult as AccountValidationResult,
  QuotaFetchResult as AccountQuotaFetchResult,
} from '../contexts/account/application/capability-ports'
import type { ValidationService as CredentialValidationService } from '../contexts/credential/application/validation-service'
import type { QuotaApplicationService } from '../contexts/quota/application/quota-service'
import { validationResultToJson } from '../contexts/credential/domain/capability-types'

export function buildAccountCapabilityRegistry(
  credentialValidation: CredentialValidationService,
  quotaService: QuotaApplicationService,
): ProviderCapabilityRegistry {
  const validationCapability: ValidationCapability = {
    async validate(accountId: string): Promise<AccountValidationResult> {
      const result = await credentialValidation.validate(accountId)
      return validationResultToJson(result)
    },
  }
  const quotaCapability: QuotaCapability = {
    async fetchQuota(accountId: string): Promise<AccountQuotaFetchResult> {
      const info = await quotaService.getQuota(accountId)
      return {
        outcome: 'success',
        source: 'live',
        freshness: 'fresh',
        fetched_at: info.fetchedAt.toISOString(),
        models: info.models.map((m) => {
          const model: AccountQuotaFetchResult['models'][number] = {
            model_name: m.modelName,
            used: m.used,
            total: m.total,
          }
          if (m.resetAt !== undefined) model.reset_at = m.resetAt.toISOString()
          return model
        }),
      }
    },
  }
  return {
    validation(): ValidationCapability | undefined {
      return validationCapability
    },
    quota(): QuotaCapability | undefined {
      return quotaCapability
    },
  }
}
