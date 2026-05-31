// Account/health/credential-switch IPC channel constants.
//
// Single source of truth now lives in src/shared/ipc-channels.ts (wired by the
// integration plan). Re-exported here so existing imports in this context keep
// working unchanged.
export { ACCOUNT_CHANNELS } from '../../../../shared/ipc-channels'
import { ACCOUNT_CHANNELS } from '../../../../shared/ipc-channels'

export type AccountChannel = (typeof ACCOUNT_CHANNELS)[keyof typeof ACCOUNT_CHANNELS]
