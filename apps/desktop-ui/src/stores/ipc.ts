// @ts-ignore
import miniToastr from 'mini-toastr'
import { defineStore } from 'pinia'

import { desktopClient } from '../lib/desktop/client'
import { createIpcStoreModel } from '../lib/ipc/ipc-store'

export const useIpcStore = defineStore('ipc', () => {
  return createIpcStoreModel({
    desktopClient,
    notifyError: (message, title) => {
      miniToastr.error(message, title)
    },
    logError: (message, error) => {
      console.error(message, error)
    },
  })
})
