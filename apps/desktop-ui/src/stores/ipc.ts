import miniToastr from 'mini-toastr'
import { defineStore } from 'pinia'

import { desktopClient } from '../lib/desktop/client'
import { createHeldKeys } from '../lib/desktop/held-keys'
import { translate } from '../lib/i18n'
import { createIpcStoreModel } from '../lib/ipc/ipc-store'

const KEY_RELEASE_TIMEOUT_MS = 500

export const useIpcStore = defineStore('ipc', () => {
  const heldKeys = createHeldKeys(window)
  return createIpcStoreModel({
    desktopClient,
    notifyError: (message, title) => {
      miniToastr?.error?.(message, title)
    },
    logError: (message, error) => {
      console.error(message, error)
    },
    errorTitle: () => translate('toast.desktopCommandFailed'),
    waitForKeysReleased: () => heldKeys.waitForRelease(KEY_RELEASE_TIMEOUT_MS),
  })
})
