import type { UserDataRelocationMode, UserDataTarget } from '@tyco/shared'

/** What the user asked to do with the data folder */
export type UserDataAction = 'choose' | 'connect'

export interface UserDataNotice {
  kind: 'info' | 'warning' | 'error'
  messageKey: string
}

/** What applying a chosen folder does */
export interface UserDataRelocation {
  /** The backend mode to apply; none while the folder cannot be used */
  mode: UserDataRelocationMode | null
  notice: UserDataNotice
  /** A subfolder to use instead of a folder with files of its own */
  subfolderPath?: string
}

const refusal = (
  messageKey: string,
  kind: UserDataNotice['kind'] = 'warning'
): UserDataRelocation => ({ mode: null, notice: { kind, messageKey } })

/**
 * What `action` does with the folder `target`: `choose` moves into an empty
 * folder or connects one that already holds TyCo data; `connect` (used when the
 * configured folder is missing) only connects an existing folder.
 */
export function describeUserDataRelocation(
  action: UserDataAction,
  target: UserDataTarget
): UserDataRelocation {
  const contents = target.contents
  switch (contents.kind) {
    case 'current':
      return refusal('settings.userData.targetCurrent', 'info')
    case 'empty':
      return action === 'choose'
        ? {
            mode: 'move',
            notice: {
              kind: 'info',
              messageKey: 'settings.userData.targetEmpty',
            },
          }
        : refusal('settings.userData.targetEmptyConnect')
    case 'userData':
      if (!contents.isSupported)
        return refusal('settings.userData.targetNewer', 'error')
      return {
        mode: 'connect',
        notice: {
          kind: 'warning',
          messageKey: 'settings.userData.targetUserData',
        },
      }
    case 'unfinished':
      return refusal('settings.userData.targetUnfinished')
    case 'occupied':
      return {
        ...refusal('settings.userData.targetOccupied'),
        subfolderPath: contents.subfolderPath,
      }
    case 'forbidden':
      return refusal('settings.userData.targetForbidden', 'error')
  }
}
