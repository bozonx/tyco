import {
  DEFAULT_DESKTOP_VIEW_STATE,
  DESKTOP_COMMANDS,
  desktopSnapshotToView,
  desktopViewToSnapshot,
  type DesktopSnapshot,
  type DesktopViewState,
  type UserConfig,
  type LocalState,
} from '@tyco/shared'
import { ref } from 'vue'
import type { DesktopInvoker } from './ipc-store'
import type { DesktopCall } from './desktop-functions'

export interface DesktopStateDeps {
  desktopClient: DesktopInvoker
  callFunction: DesktopCall
  reportFailure: (name: string, message: string) => void
}

/** Applies every snapshot through one revision gate, including write responses. */
export function createDesktopStateModel(deps: DesktopStateDeps) {
  const desktopState = ref<DesktopViewState>(
    structuredClone(DEFAULT_DESKTOP_VIEW_STATE)
  )
  let loaded = !deps.desktopClient.isAvailable()
  let localStateWrites: Promise<unknown> = Promise.resolve()

  const applyViewState = (incoming: DesktopViewState) => {
    if (incoming.revision < desktopState.value.revision) return false
    desktopState.value = incoming
    loaded = true
    return true
  }

  const applySnapshot = (snapshot: DesktopSnapshot) => {
    const accepted = applyViewState(desktopSnapshotToView(snapshot))
    loaded = true
    return accepted
  }

  const loadDesktopState = async () => {
    if (!deps.desktopClient.isAvailable()) {
      applySnapshot(
        desktopViewToSnapshot(deps.desktopClient.getDesktopViewState())
      )
      return desktopState.value
    }
    const response = await deps.desktopClient.invoke(
      DESKTOP_COMMANDS.GET_DESKTOP_STATE
    )
    if (!response.success) {
      const error = new Error(`Could not load desktop state: ${response.error}`)
      deps.reportFailure('getDesktopState', error.message)
      throw error
    }
    applySnapshot(response.result)
    return desktopState.value
  }

  const notLoaded = () => ({
    success: false as const,
    error: 'The desktop state is not loaded yet',
  })

  const saveUserConfig = async (
    userConfig: UserConfig,
    baseConfig: UserConfig = desktopState.value.userConfig
  ) => {
    if (!loaded) return notLoaded()
    const response = await deps.callFunction('saveUserConfig', [
      userConfig,
      baseConfig,
    ])
    if (!response.success) return response
    applySnapshot(response.result)
    return {
      success: true as const,
      result: response.result.settings.userConfig,
    }
  }

  const patchLocalState = (patch: Partial<LocalState>) => {
    if (!loaded) return Promise.resolve(notLoaded())
    const queuedPatch = { ...patch }
    if (patch.recentAiPrompts)
      queuedPatch.recentAiPrompts = [...patch.recentAiPrompts]
    if (patch.recentTranslateLanguages)
      queuedPatch.recentTranslateLanguages = [...patch.recentTranslateLanguages]
    const write = localStateWrites.then(async () => {
      const response = await deps.callFunction('patchLocalState', [queuedPatch])
      if (!response.success) return response
      applySnapshot(response.result)
      return {
        success: true as const,
        result: response.result.settings.localState,
      }
    })
    localStateWrites = write.catch(() => undefined)
    return write
  }

  const setExecutionConfig = (userConfig: UserConfig) => {
    desktopState.value = { ...desktopState.value, userConfig }
  }

  return {
    setExecutionConfig,
    desktopState,
    applyViewState,
    loadDesktopState,
    saveUserConfig,
    patchLocalState,
  }
}
