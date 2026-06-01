import { ipcMain } from 'electron'
import { toIpcError } from '../../../ipc/error'
import { ACCOUNT_GROUP_CHANNELS } from '../../../../shared/ipc-channels'
import type {
  AccountGroupBindingDto,
  AccountGroupDto,
  AccountGroupMembershipDto,
  AccountGroupService,
} from '../application/account-group-service'

// IPC handlers for the account-group context. Every handler unwraps the renderer
// arg shape (always camelCase, mirroring proxy/account contexts), calls the
// service, reshapes to the wire DTO, and wraps thrown errors via toIpcError so
// rejections surface as plain string messages.

interface CreateGroupReq {
  name: string
  color?: string
  description?: string
}
interface UpdateGroupReq {
  id: string
  patch: { name?: string; color?: string | null; description?: string | null }
}
interface DeleteGroupReq {
  id: string
  force?: boolean
}
interface MembersReq {
  groupId: string
  accountIds: string[]
}
interface BindReq {
  groupId: string
  proxyId?: string
}

export function registerAccountGroupHandlers(service: AccountGroupService): void {
  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.listGroups,
    async (): Promise<AccountGroupDto[]> => {
      try {
        return await service.listGroups()
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.createGroup,
    async (_e, args: CreateGroupReq): Promise<AccountGroupDto> => {
      try {
        return await service.createGroup(args)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.updateGroup,
    async (_e, args: UpdateGroupReq): Promise<AccountGroupDto> => {
      try {
        return await service.updateGroup(args.id, args.patch)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.deleteGroup,
    async (_e, args: DeleteGroupReq): Promise<void> => {
      try {
        await service.deleteGroup(args.id, { force: args.force ?? false })
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.listMembers,
    async (_e, args: { groupId: string }): Promise<AccountGroupMembershipDto[]> => {
      try {
        return await service.listMembers(args.groupId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.listGroupsForAccount,
    async (_e, args: { accountId: string }): Promise<AccountGroupDto[]> => {
      try {
        return await service.listGroupsForAccount(args.accountId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.addMembers,
    async (_e, args: MembersReq): Promise<{ added: number }> => {
      try {
        return await service.addMembers(args.groupId, args.accountIds)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.removeMembers,
    async (_e, args: MembersReq): Promise<{ removed: number }> => {
      try {
        return await service.removeMembers(args.groupId, args.accountIds)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.bindGroupToProxy,
    async (_e, args: BindReq): Promise<AccountGroupBindingDto> => {
      try {
        if (args.proxyId === undefined) {
          throw new Error('proxyId required')
        }
        return await service.bindGroupToProxy(args.groupId, args.proxyId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.unbindGroup,
    async (_e, args: { groupId: string }): Promise<void> => {
      try {
        await service.unbindGroup(args.groupId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )

  ipcMain.handle(
    ACCOUNT_GROUP_CHANNELS.getGroupBinding,
    async (_e, args: { groupId: string }): Promise<AccountGroupBindingDto | null> => {
      try {
        return await service.getGroupBinding(args.groupId)
      } catch (e) {
        throw new Error(toIpcError(e))
      }
    },
  )
}
