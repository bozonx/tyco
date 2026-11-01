import { defineStore } from 'pinia'
import type { UserDataRelocationMode } from '@tyco/shared'

import { resultOrThrow } from '../lib/ipc/ipc-model'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

/** The user data folder: where it is, and changing it */
export const useUserDataStore = defineStore('user-data', () => {
  const desktop = useDesktopStore()
  const { call } = useIpcStore()

  return {
    state: () => desktop.userData,
    inspect: async (path?: string) =>
      resultOrThrow(await call('inspect_user_data_target', { path })),
    relocate: async (mode: UserDataRelocationMode, path?: string) =>
      resultOrThrow(await call('relocate_user_data', { mode, path })),
    pickFolder: async () => resultOrThrow(await call('pick_directory')),
    open: async () =>
      resultOrThrow(await call('open_storage_location', { kind: 'user' })),
    restart: async () => resultOrThrow(await call('restart_app')),
  }
})
