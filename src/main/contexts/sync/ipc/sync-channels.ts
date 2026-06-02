// WebDAV sync IPC channel constants.
//
// Single source of truth lives in src/shared/ipc-channels.ts as `SYNC_CHANNELS`
// (sync manifest §3). This file re-exports it, mirroring account-channels.ts.
// Channel string VALUES are the canonical command names (snake_case).
export { SYNC_CHANNELS } from '../../../../shared/ipc-channels'
import { SYNC_CHANNELS } from '../../../../shared/ipc-channels'

export type SyncChannel = (typeof SYNC_CHANNELS)[keyof typeof SYNC_CHANNELS]
