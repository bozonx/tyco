import { effectScope, watch } from 'vue'
import type { DesktopViewState, StartMode, UserConfig } from '@tyco/shared'
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
  syncLocale: (appLanguage?: string, userLanguage?: string) => void
  syncDocumentLanguage: (
    config: Pick<UserConfig, 'appLanguage' | 'userLanguage'>
  ) => void
  updateTitle: () => void
  patchLastMode: (mode: StartMode) => Promise<unknown>
  replaceEditorValue: (text: string) => void
  focusEditor: () => void
  startChatWithAttachment: CapturedChatSelectionDependencies['startChatWithAttachment']
  getEditorSelection: () => string | undefined
  reportError: (error: unknown) => void
}

/** Synchronizes desktop snapshots with view effects within one owned scope. */
export function createAppStateSync(deps: AppStateSyncDependencies) {
  const capturedSelection = createCapturedSelection({
    replaceValue: deps.replaceEditorValue,
    focus: deps.focusEditor,
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
        () => deps.getDesktopState().userConfig.plugins,
        () => {
          void deps
            .reloadPlugins(deps.getDesktopState().userConfig)
            .catch(deps.reportError)
        },
        { deep: true }
      )
      watch(
        [
          () => deps.getDesktopState().userConfig.appLanguage,
          () => deps.getDesktopState().userConfig.userLanguage,
        ],
        ([appLanguage, userLanguage]) => {
          deps.syncLocale(appLanguage, userLanguage)
          deps.syncDocumentLanguage({ appLanguage, userLanguage })
        },
        { immediate: true }
      )
      watch(
        deps.getLocale,
        () => {
          const { appLanguage, userLanguage } =
            deps.getDesktopState().userConfig
          deps.syncDocumentLanguage({ appLanguage, userLanguage })
          deps.updateTitle()
        },
        { immediate: true }
      )
      watch(deps.getRoutePath, (path) => {
        const mode = Object.entries(MODE_ROUTE_MAP).find(
          ([, routePath]) => routePath === path
        )?.[0] as StartMode | undefined
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
