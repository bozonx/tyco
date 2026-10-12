import { DESKTOP_COMMANDS, type DesktopCommandArgs } from '@tyco/shared'
import type { StorageFunctions } from './functions/storage'
import type { DomainCommandMap } from './command-types'

export function createStorageCommandMap(): DomainCommandMap<
  keyof StorageFunctions
> {
  return {
    getStorageInfo: { command: DESKTOP_COMMANDS.GET_STORAGE_INFO },
    openStorageLocation: {
      command: DESKTOP_COMMANDS.OPEN_STORAGE_LOCATION,
      buildArgs: ([kind]) =>
        ({ kind }) satisfies DesktopCommandArgs<'open_storage_location'>,
    },
  }
}
