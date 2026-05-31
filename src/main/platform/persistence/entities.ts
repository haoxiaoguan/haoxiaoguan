// Central MikroORM entity registry.
//
// electron-vite bundles the entire main process into a single `main.cjs`, so the
// `out/main/**/contexts/**/*.entity.js` glob in mikro-orm.config.ts never matches
// at runtime. To guarantee `createSchema()` builds every table in the packaged
// app, every context's decorator entity is imported here and passed explicitly
// to buildOrmConfig (see database.ts).
//
// Add a context's entity to ALL_ENTITIES when it lands. Currently registered:
//   - account  (4 tables: accounts, account_tags, switch_history, credentials*)
//   - skill    (3 tables: installed_skills, skill_repos, skill_backups)
//   - usage    (3 tables: usage_records, usage_sync_state, usage_daily_rollups)
//
// (*) `credentials` is owned by the account context's TEMP CredentialRefEntity
// until the credential context lands with its own entity (see account manifest
// §2). The credential and quota contexts are not yet implemented, so their
// tables (pending_oauth, pending_import, quota_cache, account_quota_state) have
// no entities to register.

import { AccountEntity } from '../../contexts/account/infrastructure/account.entity'
import { AccountTagEntity } from '../../contexts/account/infrastructure/account-tag.entity'
import { SwitchHistoryEntity } from '../../contexts/account/infrastructure/switch-history.entity'
import { CredentialRefEntity } from '../../contexts/account/infrastructure/credential-ref.entity'

import { InstalledSkillEntity } from '../../contexts/skill/infrastructure/installed-skill.entity'
import { SkillRepoEntity } from '../../contexts/skill/infrastructure/skill-repo.entity'
import { SkillBackupEntity } from '../../contexts/skill/infrastructure/skill-backup.entity'

import { UsageRecordEntity } from '../../contexts/usage/infrastructure/usage-record.entity'
import { UsageSyncStateEntity } from '../../contexts/usage/infrastructure/usage-sync-state.entity'
import { UsageDailyRollupEntity } from '../../contexts/usage/infrastructure/usage-daily-rollup.entity'

/** All decorator entity classes registered for schema generation. */
export const ALL_ENTITIES: unknown[] = [
  // account context
  AccountEntity,
  AccountTagEntity,
  SwitchHistoryEntity,
  CredentialRefEntity,
  // skill context
  InstalledSkillEntity,
  SkillRepoEntity,
  SkillBackupEntity,
  // usage context
  UsageRecordEntity,
  UsageSyncStateEntity,
  UsageDailyRollupEntity,
]
