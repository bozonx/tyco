import {
  configuredHotkey,
  DESKTOP_EVENTS,
  type HotkeyProviderInfo,
  type IpcResult,
} from '@tyco/shared'
import { defineStore } from 'pinia'
import { onScopeDispose } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import { createGlobalHotkeysModel } from '../lib/hotkeys/global-hotkeys-model'
import { useDesktopStore } from './desktop'
import { useIpcStore } from './ipc'

/** The global shortcuts and provider status shared across settings and overlays */
export const useGlobalHotkeysStore = defineStore('globalHotkeys', () => {
  const ipc = useIpcStore()
  const desktopStore = useDesktopStore()
  const model = createGlobalHotkeysModel({
    getProviderInfo: async () =>
      (await ipc.call(
        'get_hotkey_provider_info'
      )) as IpcResult<HotkeyProviderInfo>,
    listenHotkeysChanged: (handler) =>
      desktopClient.listen(DESKTOP_EVENTS.HOTKEYS_CHANGED, handler),
    getConfiguredHotkey: (id) => configuredHotkey(desktopStore.userConfig, id),
    suspendHotkeys: (suspended) => ipc.call('suspend_hotkeys', { suspended }),
    checkTextInjection: () => ipc.call('check_text_injection'),
    configureHotkeys: () => ipc.call('open_system_hotkey_settings'),
    rebindHotkeys: () => ipc.call('rebind_hotkeys'),
  })

  onScopeDispose(model.dispose)

  return model
})
