import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { createHeldKeys } from '../lib/desktop/held-keys'
import { translate } from '../lib/i18n'
import { createDesktopStateModel } from '../lib/ipc/desktop-state'
import { createIpcModel } from '../lib/ipc/ipc-model'
import { clientLogger } from '../lib/logger'
import { useToastStore } from './toast'

const KEY_RELEASE_TIMEOUT_MS = 500

/**
 * The desktop calls and the desktop state of the window, made together: a call
 * carries the activation of the state, and a write applies its snapshot. Use
 * `useIpcStore` and `useDesktopStore` instead
 */
export const useDesktopRuntimeStore = defineStore('desktopRuntime', () => {
  const heldKeys = createHeldKeys(window)
  onScopeDispose(heldKeys.dispose)
  const toastStore = useToastStore()
  const ipc = createIpcModel({
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
    getActivationId: () => state.desktopState.value.activationId,
  })
  const state = createDesktopStateModel({
    desktopClient,
    call: ipc.call,
    reportFailure: ipc.reportFailure,
  })
  // handed out as they are: each facade store unwraps its own refs
  return { ipcModel: () => ipc, stateModel: () => state }
})
