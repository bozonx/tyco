import { effectScope, watch } from 'vue'
import type { DesktopViewState, ActivationMode, UserConfig } from '@tyco/shared'
import {
  createCapturedChatSelection,
  type CapturedChatSelectionDependencies,
} from '../chat/captured-chat-selection'
import { createCapturedSelection } from '../editor-input/captured-selection'
import { MODE_ROUTE_MAP } from '../navigation/routes'

export interface AppStateSyncDependencies {
  isQuickWindow: boolean
  getDesktopState: () => DesktopViewState
  getLocale: () => string
  getRoutePath: () => string
  reloadPlugins: (config: UserConfig) => Promise<void>
  syncLocale: (uiLanguage?: string, userLanguage?: string) => void
  syncDocumentLanguage: (language: UserConfig['language']) => void
  updateTitle: () => void
  patchLastMode: (mode: ActivationMode) => Promise<unknown>
  replaceEditorValue: (text: string) => void
  focusEditor: () => void
  getEditorValue: () => string
  startChatWithAttachment: CapturedChatSelectionDependencies['startChatWithAttachment']
  getEditorSelection: () => string | undefined
  reportError: (error: unknown) => void
}

/** Synchronizes desktop snapshots with view effects within one owned scope. */
export function createAppStateSync(deps: AppStateSyncDependencies) {
  const capturedSelection = createCapturedSelection({
    replaceValue: deps.replaceEditorValue,
    focus: deps.focusEditor,
    getValue: deps.getEditorValue,
  })
  const capturedChat = createCapturedChatSelection({
    startChatWithAttachment: deps.startChatWithAttachment,
    getSelectedText: deps.getEditorSelection,
  })
  let scope: ReturnType<typeof effectScope> | undefined
  function start() {
    if (scope?.active) return
    scope = effectScope(true)
    scope.run(() => {
      watch(
        [
          () => deps.getDesktopState().userConfig.plugins,
          () => deps.getDesktopState().userConfig.isInDevelopment,
        ],
        () => {
          void deps
            .reloadPlugins(deps.getDesktopState().userConfig)
            .catch(deps.reportError)
        },
        { deep: true }
      )
      watch(
        [
          () => deps.getDesktopState().userConfig.language.ui,
          () => deps.getDesktopState().userConfig.language.user,
        ],
        ([ui, user]) => {
          deps.syncLocale(ui, user)
          deps.syncDocumentLanguage({ ui, user })
        },
        { immediate: true }
      )
      watch(
        deps.getLocale,
        () => {
          deps.syncDocumentLanguage({
            ...deps.getDesktopState().userConfig.language,
          })
          deps.updateTitle()
        },
        { immediate: true }
      )
      watch(deps.getRoutePath, (path) => {
        const mode = Object.entries(MODE_ROUTE_MAP).find(
          ([, routePath]) => routePath === path
        )?.[0] as ActivationMode | undefined
        if (mode && mode !== deps.getDesktopState().sessionState.lastMode)
          void deps.patchLastMode(mode).catch(deps.reportError)
      })
      if (!deps.isQuickWindow)
        watch(
          () => {
            const { activationId, mode, isWindowShown, selectedText } =
              deps.getDesktopState()
            return [activationId, mode, isWindowShown, selectedText]
          },
          () => {
            capturedSelection.apply(deps.getDesktopState())
            capturedChat.apply(deps.getDesktopState())
          }
        )
    })
  }
  return { start, stop: () => scope?.stop() }
}
