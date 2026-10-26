import type { VaultTarget } from '@tyco/shared'

export interface VaultRelocationNotice {
  kind: 'info' | 'warning' | 'error'
  messageKey: string
  params?: Record<string, string | number>
}

export interface VaultRelocation {
  /** The vault can go to the folder */
  canApply: boolean
  /** The current vault can be moved along */
  canMove: boolean
  /** The current vault moves along */
  isMoving: boolean
  notice: VaultRelocationNotice
  /** A subfolder to use instead of a folder with files of its own */
  subfolderPath?: string
}

export interface VaultRelocationContext {
  /** The current vault has profiles or projects to move */
  hasCurrentData: boolean
  /** The user asked to move them */
  wantsMove: boolean
}

/** What choosing `target` as the vault folder does */
export function describeVaultRelocation(
  target: VaultTarget,
  context: VaultRelocationContext
): VaultRelocation {
  const contents = target.contents
  switch (contents.kind) {
    case 'current':
      return {
        canApply: false,
        canMove: false,
        isMoving: false,
        notice: { kind: 'info', messageKey: 'settings.vaultTargetCurrent' },
      }
    case 'empty': {
      const isMoving = context.hasCurrentData && context.wantsMove
      return {
        canApply: true,
        canMove: context.hasCurrentData,
        isMoving,
        notice: {
          kind: isMoving || !context.hasCurrentData ? 'info' : 'warning',
          messageKey: isMoving
            ? 'settings.vaultTargetEmptyMove'
            : 'settings.vaultTargetEmptyFresh',
        },
      }
    }
    case 'vault':
      return {
        canApply: true,
        canMove: false,
        isMoving: false,
        notice: {
          kind: 'warning',
          messageKey: 'settings.vaultTargetExisting',
          params: {
            profiles: contents.profileCount,
            projects: contents.projectCount,
          },
        },
      }
    case 'occupied':
      return {
        canApply: false,
        canMove: false,
        isMoving: false,
        notice: { kind: 'warning', messageKey: 'settings.vaultTargetOccupied' },
        subfolderPath: contents.subfolderPath,
      }
    case 'nested':
      return {
        canApply: false,
        canMove: false,
        isMoving: false,
        notice: { kind: 'error', messageKey: 'settings.vaultTargetNested' },
      }
  }
}
