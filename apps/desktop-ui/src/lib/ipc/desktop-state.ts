import {
  DEFAULT_DESKTOP_VIEW_STATE,
  desktopSnapshotToView,
  desktopViewToSnapshot,
  type DesktopSnapshot,
  type DesktopViewState,
  type UserConfig,
  type SessionState,
  type TextInsertionStatus,
} from '@tyco/shared'
import { computed, ref } from 'vue'
import type { DesktopCall, DesktopInvoker } from './ipc-model'

export interface DesktopStateDependencies {
  desktopClient: DesktopInvoker
  call: DesktopCall
  reportFailure: (name: string, message: string) => void
}

/** Applies every snapshot through one revision gate, including write responses. */
export function createDesktopStateModel(deps: DesktopStateDependencies) {
  const desktopState = ref<DesktopViewState>(
    structuredClone(DEFAULT_DESKTOP_VIEW_STATE)
  )
  const insertionStatus = ref<TextInsertionStatus | null>(null)
  const canInsertIntoWindow = computed(
    () =>
      Boolean(desktopState.value.windowId) ||
      insertionStatus.value?.target === 'focusReturn'
  )
  let loaded = !deps.desktopClient.isAvailable()
  let sessionStateWrites: Promise<unknown> = Promise.resolve()

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
    const response = await deps.desktopClient.invoke('get_desktop_state')
    if (!response.success) {
      const error = new Error(`Could not load desktop state: ${response.error}`)
      deps.reportFailure('get_desktop_state', error.message)
      throw error
    }
    applySnapshot(response.result)
    const insertion = await deps.desktopClient.invoke(
      'get_text_insertion_status'
    )
    insertionStatus.value = insertion.success ? insertion.result : null
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
    const response = await deps.call('save_user_config', {
      userConfig,
      baseConfig,
    })
    if (!response.success) return response
    applySnapshot(response.result)
    return { success: true as const, result: desktopState.value.userConfig }
  }

  /** Stores the fields of `patch` over the current config */
  const updateUserConfig = (patch: Partial<UserConfig>) =>
    saveUserConfig({ ...desktopState.value.userConfig, ...patch })

  const patchSessionState = (patch: Partial<SessionState>) => {
    if (!loaded) return Promise.resolve(notLoaded())
    const queuedPatch = { ...patch }
    if (patch.recentAiPrompts)
      queuedPatch.recentAiPrompts = [...patch.recentAiPrompts]
    if (patch.recentTranslateLanguages)
      queuedPatch.recentTranslateLanguages = [...patch.recentTranslateLanguages]
    const write = sessionStateWrites.then(async () => {
      const response = await deps.call('patch_session_state', {
        patch: queuedPatch,
      })
      if (!response.success) return response
      applySnapshot(response.result)
      return {
        success: true as const,
        result: response.result.settings.sessionState,
      }
    })
    sessionStateWrites = write.catch(() => undefined)
    return write
  }

  /**
   * Runs with `userConfig` until the next snapshot: an external run brings the
   * config it was started with
   */
  const setExecutionConfig = (userConfig: UserConfig) => {
    desktopState.value = { ...desktopState.value, userConfig }
  }

  return {
    setExecutionConfig,
    canInsertIntoWindow,
    desktopState,
    userConfig: computed(() => desktopState.value.userConfig),
    sessionState: computed(() => desktopState.value.sessionState),
    updateUserConfig,
    applyViewState,
    loadDesktopState,
    saveUserConfig,
    patchSessionState,
  }
}
