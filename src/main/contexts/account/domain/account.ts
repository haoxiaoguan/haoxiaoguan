import { AccountName } from './account-name'
import { Notes } from './notes'
import { Tags } from './tags'
import { PlatformAccountProfile, type JsonValue } from './platform-account-profile'

// Domain event emitted by Account.activate().
export interface AccountSwitched {
  agentId: string
  accountId: string
  timestamp: Date
}

// Fields used to reconstruct an aggregate from persistence (bypasses validation).
export interface AccountReconstructFields {
  id: string
  agentId: string
  email: string
  identityKey: string
  displayIdentifier: string
  name?: AccountName | undefined
  loginProvider?: string | undefined
  planName?: string | undefined
  planTier?: string | undefined
  status?: string | undefined
  statusReason?: string | undefined
  profilePayload: JsonValue
  tags: Tags
  notes?: Notes | undefined
  isActive: boolean
  createdAt: Date
  lastUsedAt?: Date | undefined
}

function isPlainObject(value: JsonValue): value is { [key: string]: JsonValue } {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

// Pull the first non-empty string/number/bool projection for the given keys.
function payloadString(payload: JsonValue, keys: string[]): string | undefined {
  if (!isPlainObject(payload)) return undefined
  for (const key of keys) {
    if (!(key in payload)) continue
    const value = payload[key]
    let text: string
    if (typeof value === 'string') text = value.trim()
    else if (typeof value === 'number') text = String(value)
    else if (typeof value === 'boolean') text = String(value)
    else continue
    if (text.length > 0) return text
  }
  return undefined
}

/**
 * Account aggregate root. Manages lifecycle + invariants.
 *
 * Invariants (enforced by the value objects): name ≤64, tags ≤10 each ≤32,
 * notes ≤256. "Only one active per platform" is enforced at the application
 * layer (deactivate-then-activate), not here. New accounts start inactive.
 */
export class Account {
  private readonly _id: string
  private readonly _agentId: string
  // 非 readonly：healDisplayIdentity 可用在线权威 email 修正占位显示（不影响唯一键 identityKey）。
  private _email: string
  private _identityKey: string
  private _displayIdentifier: string
  private _name?: AccountName | undefined
  private _loginProvider?: string | undefined
  private _planName?: string | undefined
  private _planTier?: string | undefined
  private _status?: string | undefined
  private _statusReason?: string | undefined
  private _profilePayload: JsonValue
  private readonly _tags: Tags
  private _notes?: Notes | undefined
  private _isActive: boolean
  private readonly _createdAt: Date
  private _lastUsedAt?: Date | undefined

  private constructor(fields: {
    id: string
    agentId: string
    email: string
    identityKey: string
    displayIdentifier: string
    name?: AccountName | undefined
    loginProvider?: string | undefined
    planName?: string | undefined
    planTier?: string | undefined
    status?: string | undefined
    statusReason?: string | undefined
    profilePayload: JsonValue
    tags: Tags
    notes?: Notes | undefined
    isActive: boolean
    createdAt: Date
    lastUsedAt?: Date | undefined
  }) {
    this._id = fields.id
    this._agentId = fields.agentId
    this._email = fields.email
    this._identityKey = fields.identityKey
    this._displayIdentifier = fields.displayIdentifier
    this._name = fields.name
    this._loginProvider = fields.loginProvider
    this._planName = fields.planName
    this._planTier = fields.planTier
    this._status = fields.status
    this._statusReason = fields.statusReason
    this._profilePayload = fields.profilePayload
    this._tags = fields.tags
    this._notes = fields.notes
    this._isActive = fields.isActive
    this._createdAt = fields.createdAt
    this._lastUsedAt = fields.lastUsedAt
  }

  /** Factory: create from email only (bare profile). Source Account::create. */
  static create(
    agentId: string,
    email: string,
    name: string | undefined,
    tags: string[],
    notes: string | undefined,
  ): Account {
    const profile = PlatformAccountProfile.fromIdentifier(email)
    return Account.createWithProfile(agentId, email, name, tags, notes, profile)
  }

  /** Factory: create with a derived platform profile. Source create_with_profile. */
  static createWithProfile(
    agentId: string,
    email: string,
    name: string | undefined,
    tags: string[],
    notes: string | undefined,
    profile: PlatformAccountProfile,
  ): Account {
    const accountName = name !== undefined ? AccountName.create(name) : undefined
    const accountTags = Tags.create(tags)
    const accountNotes = notes !== undefined ? Notes.create(notes) : undefined
    const fallbackIdentifier = email.trim().length === 0 ? profile.displayIdentifier : email
    const normalized = profile.normalized(fallbackIdentifier)

    return new Account({
      id: crypto.randomUUID(),
      agentId,
      email,
      identityKey: normalized.identityKey,
      displayIdentifier: normalized.displayIdentifier,
      name: accountName,
      loginProvider: normalized.loginProvider,
      planName: normalized.planName,
      planTier: normalized.planTier,
      status: normalized.status,
      statusReason: normalized.statusReason,
      profilePayload: normalized.profilePayload,
      tags: accountTags,
      notes: accountNotes,
      isActive: false,
      createdAt: new Date(),
      lastUsedAt: undefined,
    })
  }

  /** Reconstruct from persistence (no validation). Source Account::reconstruct. */
  static reconstruct(fields: AccountReconstructFields): Account {
    return new Account(fields)
  }

  /** Activate: mark active, bump last_used_at, return the domain event. */
  activate(): AccountSwitched {
    this._isActive = true
    this._lastUsedAt = new Date()
    return {
      agentId: this._agentId,
      accountId: this._id,
      timestamp: new Date(),
    }
  }

  /** Deactivate: mark inactive. */
  deactivate(): void {
    this._isActive = false
  }

  /** Bump last_used_at to now. */
  touch(): void {
    this._lastUsedAt = new Date()
  }

  /** Add a tag (delegates to Tags invariants). */
  addTag(tag: string): void {
    this._tags.add(tag)
  }

  /**
   * Edit user-controlled metadata in place. Re-validates each value object via
   * its factory; passing `undefined` leaves a field unchanged. The aggregate's
   * tags are replaced wholesale so the caller can both add and remove.
   *
   * Identity-bearing fields (email/identityKey/displayIdentifier/profilePayload)
   * are intentionally NOT editable here — changing them would break uniqueness
   * and quota correlation. Use re-authenticate for credential rotation instead.
   */
  editMetadata(patch: { name?: string | null; tags?: string[]; notes?: string | null }): void {
    if (patch.name !== undefined) {
      this._name = patch.name === null ? undefined : AccountName.create(patch.name)
    }
    if (patch.tags !== undefined) {
      this._tags.replaceAll(patch.tags)
    }
    if (patch.notes !== undefined) {
      this._notes = patch.notes === null ? undefined : Notes.create(patch.notes)
    }
  }

  /**
   * Merge a new payload and re-derive login_provider/plan_name/plan_tier/
   * status/status_reason.
   */
  updateProfilePayload(nextPayload: JsonValue): void {
    if (isPlainObject(this._profilePayload) && isPlainObject(nextPayload)) {
      for (const [key, value] of Object.entries(nextPayload)) {
        this._profilePayload[key] = value
      }
    } else {
      this._profilePayload = nextPayload
    }

    this._loginProvider =
      payloadString(this._profilePayload, ['loginProvider', 'login_provider']) ?? this._loginProvider
    this._planName =
      payloadString(this._profilePayload, ['planName', 'plan_name', 'planType', 'plan_type']) ??
      this._planName
    this._planTier =
      payloadString(this._profilePayload, ['planTier', 'plan_tier']) ?? this._planTier
    this._status = payloadString(this._profilePayload, ['status']) ?? this._status
    this._statusReason =
      payloadString(this._profilePayload, ['statusReason', 'status_reason']) ?? this._statusReason
  }

  /**
   * 自愈显示身份：当一次在线刷新拿到了导入时缺失的可读标识（email）时，
   * 仅更新「显示字段」(displayIdentifier/email)；identityKey 保持冻结，
   * 故唯一性与额度关联键不变——不会重复建号、不破坏活跃检测。
   *
   * 与 editMetadata 对身份字段的冻结约束并不冲突：那里禁止「用户手改」身份
   * 以免破坏去重；这里是「系统用权威在线 email 修正占位显示」，且只动显示、不动键。
   *
   * 仅在「当前显示标识不是 email（占位/不透明 userId）」且「传入的是合法 email」
   * 时生效；否则 no-op（绝不用一个 email 顶掉另一个已有 email）。返回是否发生更新。
   */
  healDisplayIdentity(email: string): boolean {
    const next = email.trim()
    if (next.length === 0 || !next.includes('@')) return false
    // 已是 email 形态的显示标识不覆盖（合法 email 必含 '@'，故此处亦保证 next !== 当前显示）。
    if (this._displayIdentifier.includes('@')) return false
    this._displayIdentifier = next
    this._email = next
    return true
  }

  // --- Getters ---
  get id(): string {
    return this._id
  }
  get agentId(): string {
    return this._agentId
  }
  get email(): string {
    return this._email
  }
  get identityKey(): string {
    return this._identityKey
  }
  get displayIdentifier(): string {
    return this._displayIdentifier
  }
  get name(): AccountName | undefined {
    return this._name
  }
  get loginProvider(): string | undefined {
    return this._loginProvider
  }
  get planName(): string | undefined {
    return this._planName
  }
  get planTier(): string | undefined {
    return this._planTier
  }
  get status(): string | undefined {
    return this._status
  }
  get statusReason(): string | undefined {
    return this._statusReason
  }
  get profilePayload(): JsonValue {
    return this._profilePayload
  }
  get tags(): Tags {
    return this._tags
  }
  get notes(): Notes | undefined {
    return this._notes
  }
  get isActive(): boolean {
    return this._isActive
  }
  get createdAt(): Date {
    return this._createdAt
  }
  get lastUsedAt(): Date | undefined {
    return this._lastUsedAt
  }
}
