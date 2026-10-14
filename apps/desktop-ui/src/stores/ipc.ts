import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { createHeldKeys } from '../lib/desktop/held-keys'
import { translate } from '../lib/i18n'
import { createIpcModel } from '../lib/ipc/ipc-model'
import { clientLogger } from '../lib/logger'
import { useToastStore } from './toast'

const KEY_RELEASE_TIMEOUT_MS = 500

export const useIpcStore = defineStore('ipc', () => {
  const heldKeys = createHeldKeys(window)
  onScopeDispose(heldKeys.dispose)
  const toastStore = useToastStore()
  return createIpcModel({
    desktopClient,
    notifyError: (message, title) => {
      toastStore.addToast(message, 'error', { title })
    },
    logError: (message, error) => {
      console.error(message, error)
      clientLogger.error(message, error, 'ipc')
    },
    errorTitle: () => translate('toast.desktopCommandFailed'),
    waitForKeysReleased: () => heldKeys.waitForRelease(KEY_RELEASE_TIMEOUT_MS),
  })
})
