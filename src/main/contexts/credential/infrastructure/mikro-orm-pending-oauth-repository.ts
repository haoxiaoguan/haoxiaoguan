import type { EntityManager } from '@mikro-orm/better-sqlite'
import { getEm as defaultGetEm } from '../../../platform/persistence/database'
import { platformFromAgentIdOrCursor, platformToAgentId } from '../../account/domain/platform-id'
import { CredentialError } from '../domain/credential-error'
import type { PendingOAuth, PendingOAuthRepository } from '../domain/pending-repository'

// MikroORM-backed PendingOAuthRepository: upsert-on-conflict by id, purge by
// expires_at < now. Uses raw SQL via the underlying connection (parameterised)
// for the ON CONFLICT upsert, matching the skill-repo repository pattern in this
// codebase.

interface PendingOAuthRow {
  id: string
  provider: string
  state: string
  code_verifier: string
  redirect_path: string
  bound_port: number | null
  created_at: string
  expires_at: string
}

function rowToDomain(row: PendingOAuthRow): PendingOAuth {
  return {
    id: row.id,
    provider: platformFromAgentIdOrCursor(row.provider),
    state: row.state,
    codeVerifier: row.code_verifier,
    redirectPath: row.redirect_path,
    boundPort: row.bound_port === null ? undefined : Number(row.bound_port),
    createdAt: new Date(row.created_at),
    expiresAt: new Date(row.expires_at),
  }
}

export class MikroOrmPendingOAuthRepository implements PendingOAuthRepository {
  private readonly getEm: () => EntityManager

  constructor(getEmFn?: () => EntityManager) {
    this.getEm = getEmFn ?? defaultGetEm
  }

  async save(pending: PendingOAuth): Promise<void> {
    try {
      const conn = this.getEm().getConnection()
      await conn.execute(
        `INSERT INTO pending_oauth
           (id, provider, state, code_verifier, redirect_path, bound_port, created_at, expires_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           provider = excluded.provider,
           state = excluded.state,
           code_verifier = excluded.code_verifier,
           redirect_path = excluded.redirect_path,
           bound_port = excluded.bound_port,
           expires_at = excluded.expires_at`,
        [
          pending.id,
          platformToAgentId(pending.provider),
          pending.state,
          pending.codeVerifier,
          pending.redirectPath,
          pending.boundPort ?? null,
          pending.createdAt.toISOString(),
          pending.expiresAt.toISOString(),
        ],
      )
    } catch (e) {
      throw CredentialError.storageError(
        `pending oauth save: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  async findById(id: string): Promise<PendingOAuth | null> {
    try {
      const conn = this.getEm().getConnection()
      const rows = (await conn.execute('SELECT * FROM pending_oauth WHERE id = ?', [
        id,
      ])) as PendingOAuthRow[]
      const row = rows[0]
      return row ? rowToDomain(row) : null
    } catch (e) {
      throw CredentialError.storageError(
        `pending oauth find: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  async delete(id: string): Promise<void> {
    try {
      const conn = this.getEm().getConnection()
      await conn.execute('DELETE FROM pending_oauth WHERE id = ?', [id])
    } catch (e) {
      throw CredentialError.storageError(
        `pending oauth delete: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }

  async purgeExpired(now: Date): Promise<number> {
    try {
      const conn = this.getEm().getConnection()
      const before = (await conn.execute('SELECT COUNT(*) AS n FROM pending_oauth WHERE expires_at < ?', [
        now.toISOString(),
      ])) as Array<{ n: number }>
      await conn.execute('DELETE FROM pending_oauth WHERE expires_at < ?', [now.toISOString()])
      return Number(before[0]?.n ?? 0)
    } catch (e) {
      throw CredentialError.storageError(
        `pending oauth purge: ${e instanceof Error ? e.message : String(e)}`,
      )
    }
  }
}
