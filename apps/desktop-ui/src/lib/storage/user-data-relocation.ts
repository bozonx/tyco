import type { UserDataRelocationMode, UserDataTarget } from '@tyco/shared'

/** What the user asked to do with the data folder */
export type UserDataAction = 'move' | 'connect' | 'resetToDefault'

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
 * What `action` does with the folder `target`. The user decides between moving
 * and connecting; a folder that does not fit the action says why rather than
 * doing the other one
 */
export function describeUserDataRelocation(
  action: UserDataAction,
  target: UserDataTarget
): UserDataRelocation {
  const contents = target.contents
  if (action === 'resetToDefault') {
    // the default folder takes the data only when it holds none of its own
    return contents.kind === 'empty' || contents.kind === 'occupied'
      ? {
          mode: 'resetToDefault',
          notice: { kind: 'info', messageKey: 'settings.userData.resetMove' },
        }
      : contents.kind === 'current'
        ? refusal('settings.userData.targetCurrent', 'info')
        : contents.kind === 'forbidden'
          ? refusal('settings.userData.targetForbidden', 'error')
          : {
              mode: 'useDefault',
              notice: {
                kind: 'warning',
                messageKey: 'settings.userData.resetHasData',
              },
            }
  }
  switch (contents.kind) {
    case 'current':
      return refusal('settings.userData.targetCurrent', 'info')
    case 'empty':
      return action === 'move'
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
      return action === 'connect'
        ? {
            mode: 'connect',
            notice: {
              kind: 'warning',
              messageKey: 'settings.userData.targetUserData',
            },
          }
        : refusal('settings.userData.targetUserDataMove')
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
