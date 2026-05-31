// Quota IPC channel constants.
//
// Single source of truth lives in src/shared/ipc-channels.ts (quota manifest §3).
// This file re-exports it, mirroring contexts/account/ipc/account-channels.ts.
// NOTE: start_oauth / complete_oauth / validate_* appear in the quota map but are
// OWNED by the credential context — they are NOT registered here.
export { QUOTA_CHANNELS } from '../../../../shared/ipc-channels'
import { QUOTA_CHANNELS } from '../../../../shared/ipc-channels'

export type QuotaChannel = (typeof QUOTA_CHANNELS)[keyof typeof QUOTA_CHANNELS]
