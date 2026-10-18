import { defineStore } from 'pinia'

import { useDesktopRuntimeStore } from './desktop-runtime'

/** Calls the desktop functions of the backend */
export const useIpcStore = defineStore('ipc', () =>
  useDesktopRuntimeStore().ipcModel()
)
