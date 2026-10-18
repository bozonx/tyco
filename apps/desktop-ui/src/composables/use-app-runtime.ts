import { nextTick, onMounted, onUnmounted, onScopeDispose } from 'vue'
import { useRoute } from 'vue-router'

import { useEditorNavigation } from '../composables/use-editor-navigation'
import { useI18n } from '../composables/use-i18n'
import useToast from '../composables/use-toast'
import { createActivationMetricsClient } from '../lib/activation-metrics/activation-metrics'
import { createAppStateSync } from '../lib/app/app-state-sync'
import { createAppBootstrap } from '../lib/app/app-bootstrap'
import { createAppWindowController } from '../lib/app/app-window-controller'
import { createMainWindowReset } from '../lib/app/main-window-reset'
import { desktopClient } from '../lib/desktop/client'
import { isQuickWindow as isInQuickWindow } from '../lib/desktop/window'
import { syncI18nLocale } from '../lib/i18n'
import { syncDocumentLanguageAttributes } from '../lib/locale/language'
import { clientLogger } from '../lib/logger'
import { appNavigation } from '../lib/navigation/navigation'
import { isQuickWindowMode } from '../lib/navigation/routes'
import { createSettingsShutdown } from '../lib/settings/settings-shutdown'
import { useChatStore } from '../stores/chat'
import { useChatInputStore } from '../stores/chat-input'
import { useCommandLauncherStore } from '../stores/command-launcher'
import { useDefaultCommandsStore } from '../stores/default-commands'
import { useEditorInputStore } from '../stores/editor-input'
import { useExternalCommandsStore } from '../stores/external-commands'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { usePluginRuntimeStore } from '../stores/plugin-runtime'
import { useQuickInputStore } from '../stores/quick-input'
import { useSelectionReplaceStore } from '../stores/selection-replace'
import { useSettingsSessionStore } from '../stores/settings-session'
import { useThemeStore } from '../stores/theme'
import { useToolCatalogStore } from '../stores/tool-catalog'
import { DESKTOP_COMMANDS, DESKTOP_EVENTS } from '@tyco/shared'

/** Wires application services to the lifetime of the root component. */
export function useAppRuntime() {
  useThemeStore()
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const pluginRuntime = usePluginRuntimeStore()
  const { locale, t } = useI18n()
  const menuModalsStore = useMenuModalsStore()
  const navPanelStore = useNavPanelStore()
  const chatStore = useChatStore()
  const chatInputStore = useChatInputStore()
  const editorInputStore = useEditorInputStore()
  const quickInputStore = useQuickInputStore()
  const editorNavigation = useEditorNavigation()
  const route = useRoute()
  const isQuickWindow = isInQuickWindow()
  const { toastKey } = useToast()
  const settingsShutdown = createSettingsShutdown({
    flush: async () => {
      await desktopStore.loadDesktopState()
      const session = useSettingsSessionStore()
      await session.persist()
      return session.isSaved()
    },
    acknowledge: async (requestId, saved) => {
      const result = await desktopClient.invoke(
        DESKTOP_COMMANDS.ACKNOWLEDGE_SETTINGS_SHUTDOWN,
        { requestId, saved }
      )
      if (!result.success) throw new Error(result.error)
    },
    notifyError: () => toastKey('settings.shutdownCancelled', 'error'),
  })
  // The benchmark activates the write mode only. Tauri delivers its events to
  // every window, and an answer from the main window would race the real one
  const activationMetrics = createActivationMetricsClient({
    listen: (event, handler) =>
      desktopClient.listen(
        event === 'start'
          ? DESKTOP_EVENTS.ACTIVATION_METRICS_START
          : DESKTOP_EVENTS.ACTIVATION_METRICS_COLLECT,
        handler
      ),
    mark: (id, mark) => {
      void ipcStore.callFunction('markActivationMetric', [id, mark])
    },
    submitValue: (id) => {
      void ipcStore.callFunction('submitActivationMetricValue', [
        id,
        quickInputStore.value,
      ])
    },
    prepareTrial: () => quickInputStore.clear(),
    activeElement: () => document.activeElement,
    requestFrame: (handler) => requestAnimationFrame(handler),
    eventTarget: document,
  })
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.window = isQuickWindow ? 'quick' : 'main'
  }
  const mainWindowReset = createMainWindowReset({
    closeAllModals: () => menuModalsStore.cancelAndCloseAll(),
    goToEditor: () => appNavigation.goToEditor(),
  })
  const bootstrap = createAppBootstrap({
    loadDesktopState: () => desktopStore.loadDesktopState(),
    onError: (error) =>
      clientLogger.error('Could not refresh desktop state', error, 'bootstrap'),
    addWindowFocusListener: (handler) => {
      window.addEventListener('focus', handler)
      return () => window.removeEventListener('focus', handler)
    },
    applyViewState: (params) => desktopStore.applyViewState(params),
    closeAllModals: () => menuModalsStore.cancelAndCloseAll(),
    navigateTo: (path) => appNavigation.push(path),
    // the quick window has no routes of its own: it renders by the mode
    ownsMode: (mode) => isQuickWindow || !isQuickWindowMode(mode),
    listen: desktopClient.listen,
    initPlugins: async () => {
      await pluginRuntime.refreshInstalledPlugins()
      await pluginRuntime.reloadPlugins()
      // external calls find the commands of plugin tools by this catalog
      if (isQuickWindow) useToolCatalogStore().start()
    },
    // The nav panel turns Esc into a step back. The quick window has no nav
    // panel, and there Esc must cancel and close: its screens handle it
    handleNavKeyUp: (event) => {
      if (!isQuickWindow) navPanelStore.handleKeyUp(event)
    },
    addWindowKeyupListener: (handler) => {
      window.addEventListener('keyup', handler)

      return () => {
        window.removeEventListener('keyup', handler)
      }
    },
  })

  const stateSync = createAppStateSync({
    isQuickWindow,
    getDesktopState: () => desktopStore.desktopState,
    getLocale: () => locale.value,
    getRoutePath: () => route.path,
    reloadPlugins: pluginRuntime.reloadPlugins,
    syncLocale: syncI18nLocale,
    syncDocumentLanguage: syncDocumentLanguageAttributes,
    updateTitle: () => {
      document.title = t('app.title')
    },
    patchLastMode: (lastMode) => desktopStore.patchSessionState({ lastMode }),
    replaceEditorValue: editorInputStore.replaceValue,
    focusEditor: editorInputStore.requestFocus,
    startChatWithAttachment: (attachment) =>
      chatStore
        .startChat({ attachments: [attachment] })
        .catch((error: unknown) =>
          clientLogger.error(
            'Could not capture chat selection',
            error,
            'bootstrap'
          )
        ),
    getEditorSelection: () => editorInputStore.selectedText,
    reportError: (error) =>
      clientLogger.error(
        'App state synchronization failed',
        error,
        'bootstrap'
      ),
  })
  stateSync.start()
  onScopeDispose(stateSync.stop)

  const controller = createAppWindowController({
    isQuickWindow,
    listen: desktopClient.listen,
    reportError: (error) =>
      clientLogger.error('App runtime failed', error, 'bootstrap'),
    startBootstrap: bootstrap.start,
    stopBootstrap: bootstrap.stop,
    startDefaultCommands: () => useDefaultCommandsStore().start(),
    startMetrics: activationMetrics.start,
    stopMetrics: activationMetrics.stop,
    disposePlugins: pluginRuntime.dispose,
    refreshPlugins: pluginRuntime.refreshInstalledPlugins,
    shutdown: settingsShutdown,
    runSelection: (payload) => useSelectionReplaceStore().handleRun(payload),
    cancelSelection: (runId) => useSelectionReplaceStore().handleCancel(runId),
    runCommand: (payload) => useExternalCommandsStore().handleRun(payload),
    cancelCommand: (id) => useExternalCommandsStore().handleCancel(id),
    cancelLauncher: (id) => useCommandLauncherStore().cancelExternal(id),
    closeModals: menuModalsStore.closeAll,
    goToChat: appNavigation.goToChat,
    startChat: chatStore.startChat,
    openLastChat: chatStore.openLastOrNewChat,
    afterRender: nextTick,
    setChatInput: chatInputStore.setValue,
    sendChatInput: chatStore.sendInput,
    focusChatInput: chatInputStore.requestFocus,
    applyEditorTransfer: editorNavigation.applyEditorTransfer,
    goToEditor: appNavigation.goToEditor,
    resetMainWindow: mainWindowReset.reset,
  })
  onMounted(() => {
    void controller.start()
  })
  onUnmounted(controller.stop)

  return { settingsShutdown, t, isQuickWindow, navPanelStore }
}
