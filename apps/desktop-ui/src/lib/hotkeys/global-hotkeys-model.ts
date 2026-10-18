import type { HotkeyProviderInfo, IpcResult } from '@tyco/shared'
import { reactive, ref } from 'vue'

import {
  activationShortcutLabel,
  applyProviderInfo,
  createHotkeySettingsState,
} from './hotkey-settings'

export interface GlobalHotkeysModelDependencies {
  getProviderInfo: () => Promise<IpcResult<HotkeyProviderInfo>>
  listenHotkeysChanged: (handler: () => void) => Promise<() => void>
  getConfiguredHotkey: (mode: string) => string
  suspendHotkeys: (suspended: boolean) => Promise<IpcResult<void>>
  checkTextInjection: () => Promise<IpcResult<void>>
  configureHotkeys: () => Promise<IpcResult<void>>
  rebindHotkeys: () => Promise<IpcResult<void>>
}

export function createGlobalHotkeysModel(deps: GlobalHotkeysModelDependencies) {
  const providerState = reactive(createHotkeySettingsState())
  const portalError = ref('')
  const isRebinding = ref(false)
  const injection = reactive<{ ok: boolean | null; error: string }>({
    ok: null,
    error: '',
  })

  let loading: Promise<void> | undefined
  let unlisten: (() => void) | undefined
  let disposed = false

  const refresh = async () => {
    const result = await deps.getProviderInfo()
    if (result.success && result.result) {
      applyProviderInfo(providerState, result.result)
    }
  }

  const ensureListening = () => {
    if (loading) return
    void deps
      .listenHotkeysChanged(() => {
        void refresh()
      })
      .then((stop) => {
        if (disposed) stop()
        else unlisten = stop
      })
      .catch(() => undefined)
  }

  /** Loads the provider once and follows its changes afterwards */
  const load = () => {
    ensureListening()
    loading ??= refresh()
    return loading
  }

  /** Reloads provider info and ensures event subscription is active */
  const reload = () => {
    ensureListening()
    loading = refresh()
    return loading
  }

  /** The shortcut that opens `mode`, empty when none is bound */
  const shortcutLabel = (mode: string) =>
    activationShortcutLabel(providerState, mode, deps.getConfiguredHotkey(mode))

  const suspendHotkeys = (suspended: boolean) => {
    void deps.suspendHotkeys(suspended)
  }

  const checkTextInjection = async () => {
    injection.ok = null
    const result = await deps.checkTextInjection()
    injection.ok = result.success
    injection.error = result.error ?? ''
  }

  const configureHotkeys = async (fallbackError: string) => {
    portalError.value = ''
    const result = await deps.configureHotkeys()
    if (!result.success) {
      portalError.value = result.error || fallbackError
    }
  }

  const rebindHotkeys = async (fallbackError: string) => {
    portalError.value = ''
    isRebinding.value = true
    const result = await deps.rebindHotkeys()
    isRebinding.value = false
    if (!result.success) {
      portalError.value = result.error || fallbackError
    }
  }

  const dispose = () => {
    disposed = true
    unlisten?.()
    unlisten = undefined
  }

  return {
    providerState,
    portalError,
    isRebinding,
    injection,
    load,
    reload,
    refresh,
    shortcutLabel,
    suspendHotkeys,
    checkTextInjection,
    configureHotkeys,
    rebindHotkeys,
    dispose,
  }
}
