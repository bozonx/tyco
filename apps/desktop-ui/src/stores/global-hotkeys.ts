import { defineStore } from 'pinia'
import { reactive } from 'vue'

import { desktopClient } from '../lib/desktop/client'
import {
  activationShortcutLabel,
  applyProviderInfo,
  createHotkeySettingsState,
} from '../lib/hotkeys/hotkey-settings'
import { useIpcStore } from './ipc'
import { DESKTOP_EVENTS, type HotkeyProviderInfo } from '@tyco/shared'

/** The global shortcuts as the hotkey provider reports them, for display */
export const useGlobalHotkeysStore = defineStore('globalHotkeys', () => {
  const ipc = useIpcStore()
  const providerState = reactive(createHotkeySettingsState())
  let loading: Promise<void> | undefined

  const refresh = async () => {
    const result = await ipc.callFunction('getHotkeyProviderInfo')
    if (result.success)
      applyProviderInfo(providerState, result.result as HotkeyProviderInfo)
  }

  /** Loads the provider once and follows its changes afterwards */
  const load = () => {
    if (loading) return loading
    void desktopClient
      .listen(DESKTOP_EVENTS.HOTKEYS_CHANGED, refresh)
      .catch(() => undefined)
    loading = refresh()
    return loading
  }

  /** The shortcut that opens `mode`, empty when none is bound */
  const shortcutLabel = (mode: string) =>
    activationShortcutLabel(
      providerState,
      mode,
      ipc.desktopState.userConfig.hotkeys?.[mode] ?? ''
    )

  return { load, shortcutLabel }
})
