// Central MikroORM entity registry.
//
// electron-vite bundles the entire main process into a single `main.cjs`, so the
// `out/main/**/contexts/**/*.entity.js` glob in mikro-orm.config.ts never matches
// at runtime. To guarantee `createSchema()` builds every table in the packaged
// app, every context's decorator entity is imported here and passed explicitly
// to buildOrmConfig (see database.ts).
//
// Add a context's entity to ALL_ENTITIES when it lands. Currently registered:
//   - account     (3 tables: accounts, account_tags, switch_history)
//   - credential  (3 tables: credentials, pending_oauth, pending_import)
//   - skill       (3 tables: installed_skills, skill_repos, skill_backups)
//   - usage       (3 tables: usage_records, usage_sync_state, usage_daily_rollups)
//   - quota       (2 tables: quota_cache, account_quota_state)
//   - mcp         (1 table: mcp_servers)
//   - proxy       (2 tables: proxies, account_proxy_bindings)
//   - api-proxy   (2 tables: api_proxy_keys, relay_upstreams)
//
// The `credentials` table is owned by the credential context's CredentialEntity
// (it supersedes the account context's former TEMP CredentialRefEntity, now
// deleted — see credential manifest §2). credentials FK → accounts ON DELETE
// CASCADE, so the account entities must register before/with it (they do).

import { AccountEntity } from '../../contexts/account/infrastructure/account.entity'
import { AccountTagEntity } from '../../contexts/account/infrastructure/account-tag.entity'
import { SwitchHistoryEntity } from '../../contexts/account/infrastructure/switch-history.entity'

import { CredentialEntity } from '../../contexts/credential/infrastructure/credential.entity'
import { PendingOAuthEntity } from '../../contexts/credential/infrastructure/pending-oauth.entity'
import { PendingImportEntity } from '../../contexts/credential/infrastructure/pending-import.entity'

import { InstalledSkillEntity } from '../../contexts/skill/infrastructure/installed-skill.entity'
import { SkillRepoEntity } from '../../contexts/skill/infrastructure/skill-repo.entity'
import { SkillBackupEntity } from '../../contexts/skill/infrastructure/skill-backup.entity'

import { UsageRecordEntity } from '../../contexts/usage/infrastructure/usage-record.entity'
import { UsageSyncStateEntity } from '../../contexts/usage/infrastructure/usage-sync-state.entity'
import { UsageDailyRollupEntity } from '../../contexts/usage/infrastructure/usage-daily-rollup.entity'

import { QuotaCacheEntity } from '../../contexts/quota/infrastructure/quota-cache.entity'
import { AccountQuotaStateEntity } from '../../contexts/quota/infrastructure/account-quota-state.entity'

import { McpServerEntity } from '../../contexts/mcp/infrastructure/mcp-server.entity'

import { ProxyEntity } from '../../contexts/proxy/infrastructure/proxy.entity'
import { AccountProxyBindingEntity } from '../../contexts/proxy/infrastructure/account-proxy-binding.entity'

import { AccountGroupEntity } from '../../contexts/accountGroup/infrastructure/account-group.entity'
import { AccountGroupMembershipEntity } from '../../contexts/accountGroup/infrastructure/account-group-membership.entity'
import { AccountGroupProxyBindingEntity } from '../../contexts/accountGroup/infrastructure/account-group-proxy-binding.entity'

import { ApiProxyKeyEntity } from '../../contexts/apiProxy/infrastructure/api-proxy-key.entity'
import { RelayUpstreamEntity } from '../../contexts/apiProxy/infrastructure/relay/relay-upstream.entity'

import { ClientConfigProfileEntity } from '../../contexts/clientConfig/infrastructure/client-config-profile.entity'

import { ActivityEventEntity } from '../../contexts/activity/infrastructure/activity-event.entity'
import { ActivityDailyRollupEntity } from '../../contexts/activity/infrastructure/activity-daily-rollup.entity'
import { ActivityScanStateEntity } from '../../contexts/activity/infrastructure/activity-scan-state.entity'

/** All decorator entity classes registered for schema generation. */
export const ALL_ENTITIES: unknown[] = [
  // account context
  AccountEntity,
  AccountTagEntity,
  SwitchHistoryEntity,
  // credential context
  CredentialEntity,
  PendingOAuthEntity,
  PendingImportEntity,
  // skill context
  InstalledSkillEntity,
  SkillRepoEntity,
  SkillBackupEntity,
  // usage context
  UsageRecordEntity,
  UsageSyncStateEntity,
  UsageDailyRollupEntity,
  // quota context
  QuotaCacheEntity,
  AccountQuotaStateEntity,
  // mcp context
  McpServerEntity,
  // proxy context
  ProxyEntity,
  AccountProxyBindingEntity,
  // account-group context
  AccountGroupEntity,
  AccountGroupMembershipEntity,
  AccountGroupProxyBindingEntity,
  // api-proxy context
  ApiProxyKeyEntity,
  RelayUpstreamEntity,
  // client-config context (1 table: client_config_profiles)
  ClientConfigProfileEntity,
  // activity context
  ActivityEventEntity,
  ActivityDailyRollupEntity,
  ActivityScanStateEntity,
]
