import {
  DESKTOP_EVENTS,
  type HotkeyProviderInfo,
  type IpcResult,
} from '@tyco/shared'
import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { createGlobalHotkeysModel } from '../lib/hotkeys/global-hotkeys-model'
import { useIpcStore } from './ipc'

/** The global shortcuts and provider status shared across settings and overlays */
export const useGlobalHotkeysStore = defineStore('globalHotkeys', () => {
  const ipc = useIpcStore()
  const model = createGlobalHotkeysModel({
    getProviderInfo: async () =>
      (await ipc.callFunction(
        'getHotkeyProviderInfo'
      )) as IpcResult<HotkeyProviderInfo>,
    listenHotkeysChanged: (handler) =>
      desktopClient.listen(DESKTOP_EVENTS.HOTKEYS_CHANGED, handler),
    getConfiguredHotkey: (mode) =>
      ipc.desktopState.userConfig.hotkeys?.[mode] ?? '',
    suspendHotkeys: (suspended) =>
      ipc.callFunction('suspendHotkeys', [suspended]),
    checkTextInjection: () => ipc.callFunction('checkTextInjection'),
    configureHotkeys: () => ipc.callFunction('configureHotkeys'),
    rebindHotkeys: () => ipc.callFunction('rebindHotkeys'),
  })

  onScopeDispose(model.dispose)

  return model
})
