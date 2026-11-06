import { nextTick, onMounted, onUnmounted, onScopeDispose } from 'vue'
import { useRoute } from 'vue-router'

import { useDismissibleLayer } from './use-dismissible-layer'
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
import { appNavigation } from '../navigation'
import { APP_ROUTES, isQuickWindowMode } from '../lib/navigation/routes'
import { createSettingsShutdown } from '../lib/settings/settings-shutdown'
import { useChatStore, useProfileChatStore } from '../stores/chat'
import {
  useChatInputStore,
  useProfileChatInputStore,
} from '../stores/chat-input'
import { useEditorInputStore } from '../stores/editor-input'
import { useExternalCommandsStore } from '../stores/external-commands'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { useHistoryStore } from '../stores/history'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { usePluginRuntimeStore } from '../stores/plugin-runtime'
import { useQuickInputStore } from '../stores/quick-input'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useSelectionReplaceStore } from '../stores/selection-replace'
import { useSettingsSessionStore } from '../stores/settings-session'
import { useThemeStore } from '../stores/theme'
import { useToolCatalogStore } from '../stores/tool-catalog'
import { DESKTOP_EVENTS, DESKTOP_WINDOW_LABELS } from '@tyco/shared'

/** Wires application services to the lifetime of the root component. */
export function useAppRuntime() {
  useThemeStore()
  const ipcStore = useIpcStore()
  const desktopStore = useDesktopStore()
  const isQuickWindow = isInQuickWindow()
  const pluginRuntime = usePluginRuntimeStore()
  const { locale, t } = useI18n()
  const menuModalsStore = useMenuModalsStore()
  const navPanelStore = useNavPanelStore()
  useDismissibleLayer({
    isOpen: () => !isQuickWindow,
    elements: () => [],
    canDismissOutside: false,
    keyboardPhase: 'bubble',
    dismiss: () => {},
    keydown: (event) => {
      if (event.key === 'Escape') {
        if (event.shiftKey) {
          event.preventDefault()
          menuModalsStore.cancelPending()
          menuModalsStore.closeAll()
          void ipcStore.callOrNotify('hide_window')
          return
        }
        navPanelStore.handleKeyDown(event)
      }
    },
  })
  const chatStore = useChatStore()
  const chatInputStore = useChatInputStore()
  const editorInputStore = useEditorInputStore()
  const quickInputStore = useQuickInputStore()
  const editorNavigation = useEditorNavigation()
  const route = useRoute()
  const { toastKey } = useToast()
  const historyStore = useHistoryStore()
  const settingsShutdown = createSettingsShutdown({
    flush: async () => {
      // every draft: the config and those kept apart, e.g. of an AI profile
      const results = await Promise.all([
        useSettingsSessionStore().flushAll(),
        historyStore.flushInputs(),
      ])
      return results.every(Boolean)
    },
    acknowledge: async (requestId, saved) => {
      const result = await desktopClient.invoke(
        'acknowledge_settings_shutdown',
        { requestId, saved }
      )
      if (!result.success) throw new Error(result.error)
    },
    notifyError: () => {
      // the main window shows the settings that block the exit; the quick
      // window has none to show
      if (isQuickWindow) return
      toastKey('settings.shutdownCancelled', 'error')
      if (!appNavigation.isCurrent(APP_ROUTES.CONFIG.path))
        void appNavigation.goToConfig()
    },
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
      void ipcStore.call('mark_activation_metric', { id, mark })
    },
    submitValue: (id) => {
      void ipcStore.call('submit_activation_metric_value', {
        id,
        value: quickInputStore.value,
      })
    },
    prepareTrial: () => quickInputStore.clear(),
    activeElement: () => document.activeElement,
    requestFrame: (handler) => requestAnimationFrame(handler),
    eventTarget: document,
  })
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.window = isQuickWindow
      ? DESKTOP_WINDOW_LABELS.QUICK
      : DESKTOP_WINDOW_LABELS.MAIN
  }
  const quickDismiss = useQuickDismissStore()
  const mainWindowReset = createMainWindowReset({
    hasActiveInput: () => quickDismiss.isHeld,
    closeAllModals: () => menuModalsStore.cancelAndCloseAll(),
    goToEditor: () => appNavigation.goToEditor(),
  })
  const bootstrap = createAppBootstrap({
    hasActiveInput: () => quickDismiss.isHeld,
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
      if (!isQuickWindow) {
        void ipcStore
          .call('set_tray_menu_labels', {
            showLabel: t('tray.show'),
            quitLabel: t('tray.quit'),
            tooltipLabel: t('tray.tooltip'),
          })
          .catch((error: unknown) =>
            clientLogger.error(
              'Could not localize tray menu',
              error,
              'bootstrap'
            )
          )
      }
    },
    patchLastMode: (lastMode) => desktopStore.patchSessionState({ lastMode }),
    replaceEditorValue: editorInputStore.replaceValue,
    focusEditor: editorInputStore.requestFocus,
    getEditorValue: () => editorInputStore.value,
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
    startMetrics: activationMetrics.start,
    stopMetrics: activationMetrics.stop,
    disposePlugins: pluginRuntime.dispose,
    refreshPlugins: pluginRuntime.refreshInstalledPlugins,
    // A failed first capture leaves no TyCo window to show a toast in
    notifyScreenshotFailed: () => {
      if (desktopStore.desktopState.isWindowShown) {
        toastKey('screenshot.failed', 'error')
        return
      }
      void ipcStore.call('show_status_overlay', {
        request: {
          kind: 'error',
          text: t('screenshot.failed'),
          hideAfterMs: 6000,
        },
      })
    },
    notifySettingsConflict: () =>
      toastKey('settings.userData.syncConflictToast', 'warn'),
    shutdown: settingsShutdown,
    runSelection: (payload) => useSelectionReplaceStore().handleRun(payload),
    cancelSelection: (runId) => useSelectionReplaceStore().handleCancel(runId),
    runCommand: (payload) => useExternalCommandsStore().handleRun(payload),
    cancelCommand: (id) => useExternalCommandsStore().handleCancel(id),
    closeModals: menuModalsStore.closeAll,
    goToChat: appNavigation.goToChat,
    goToProfileChat: appNavigation.goToProfileChat,
    profileChat: (profileId: string) => {
      const store = useProfileChatStore(profileId)
      const input = useProfileChatInputStore(profileId)
      return {
        startChat: store.startChat,
        openLastChat: store.openLastOrNewChat,
        openChat: store.openChat,
        setChatInput: input.setValue,
        sendChatInput: store.sendInput,
        focusChatInput: input.requestFocus,
      }
    },
    startChat: chatStore.startChat,
    openLastChat: chatStore.openLastOrNewChat,
    openChat: chatStore.openChat,
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
