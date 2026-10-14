<template>
  <MenuModals />
  <p
    v-if="settingsShutdown.isClosing.value"
    role="status"
    class="shutdown-status"
  >
    {{ t('settings.shutdownSaving') }}
  </p>
  <template v-if="isQuickWindow">
    <QuickOverlay />
  </template>
  <template v-else>
    <div class="layout" :inert="settingsShutdown.isClosing.value">
      <NavPanel v-if="navPanelStore.navPanelState.panelVisible" />
      <div class="main">
        <RouterView />
      </div>
    </div>
  </template>
  <ToastContainer />
</template>

<script setup lang="ts">
import { nextTick, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import ToastContainer from './components/common/ToastContainer.vue'
import QuickOverlay from './components/quick/QuickOverlay.vue'
import { useEditorNavigation } from './composables/use-editor-navigation'
import { useI18n } from './composables/use-i18n'
import useToast from './composables/use-toast'
import { createActivationMetricsClient } from './lib/activation-metrics/activation-metrics'
import { createAppBootstrap } from './lib/app/app-bootstrap'
import { createCleanupScope } from './lib/app/cleanup-scope'
import { createMainWindowReset } from './lib/app/main-window-reset'
import { createCapturedChatSelection } from './lib/chat/captured-chat-selection'
import { desktopClient } from './lib/desktop/client'
import { getDesktopWindowLabel } from './lib/desktop/window'
import { createCapturedSelection } from './lib/editor-input/captured-selection'
import { syncI18nLocale } from './lib/i18n'
import { syncDocumentLanguageAttributes } from './lib/locale/language'
import { clientLogger } from './lib/logger'
import { appNavigation } from './lib/navigation/navigation'
import { MODE_ROUTE_MAP, isQuickWindowMode } from './lib/navigation/routes'
import { createSettingsShutdown } from './lib/settings/settings-shutdown'
import { useChatStore } from './stores/chat'
import { useChatInputStore } from './stores/chat-input'
import { useCommandLauncherStore } from './stores/command-launcher'
import { useDefaultCommandsStore } from './stores/commands'
import { useEditorInputStore } from './stores/editor-input'
import { useExternalCommandsStore } from './stores/external-commands'
import { useIpcStore } from './stores/ipc'
import { useMenuModalsStore } from './stores/menu-modals'
import { useNavPanelStore } from './stores/nav-panel'
import { usePluginRuntimeStore } from './stores/plugin-runtime'
import { useQuickInputStore } from './stores/quick-input'
import { useSelectionReplaceStore } from './stores/selection-replace'
import { useSettingsSessionStore } from './stores/settings-session'
import { useThemeStore } from './stores/theme'
import { useToolCatalogStore } from './stores/tool-catalog'
import { type StartMode } from '@tyco/shared'
import { type AppEventPayloads } from '@tyco/shared'
import { DESKTOP_COMMANDS, DESKTOP_EVENTS } from '@tyco/shared'

useThemeStore()
const ipcStore = useIpcStore()
const pluginRuntime = usePluginRuntimeStore()
const { locale, t } = useI18n()
const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const chatInputStore = useChatInputStore()
const editorInputStore = useEditorInputStore()
const quickInputStore = useQuickInputStore()
const routeParamsStore = useEditorNavigation()
const route = useRoute()
const isQuickWindow = getDesktopWindowLabel() === 'quick'
const { toast } = useToast()
const settingsShutdown = createSettingsShutdown({
  flush: async () => {
    await ipcStore.loadDesktopState()
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
  notifyError: () => toast('settings.shutdownCancelled', 'error'),
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
const runtimeScope = createCleanupScope()
const listenDesktop = <K extends keyof AppEventPayloads>(
  event: K,
  handler: (payload: AppEventPayloads[K]) => void | Promise<void>
) => runtimeScope.listen(desktopClient.listen, event, handler)
const mainWindowReset = createMainWindowReset({
  closeAllModals: () => menuModalsStore.cancelAndCloseAll(),
  goToEditor: () => appNavigation.goToEditor(),
})
const bootstrap = createAppBootstrap({
  loadDesktopState: () => ipcStore.loadDesktopState(),
  onError: (error) =>
    clientLogger.error('Could not refresh desktop state', error, 'bootstrap'),
  addWindowFocusListener: (handler) => {
    window.addEventListener('focus', handler)
    return () => window.removeEventListener('focus', handler)
  },
  applyViewState: (params) => ipcStore.applyViewState(params),
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

watch(
  () => ipcStore.desktopState?.userConfig?.plugins,
  (plugins) => {
    void pluginRuntime.reloadPlugins({
      ...ipcStore.desktopState.userConfig,
      plugins,
    })
  },
  { deep: true }
)

watch(
  () => [
    ipcStore.desktopState.userConfig?.appLanguage,
    ipcStore.desktopState.userConfig?.userLanguage,
  ],
  ([appLanguage, userLanguage]) => {
    syncI18nLocale(appLanguage, userLanguage)
  },
  { immediate: true }
)

watch(
  () => ipcStore.desktopState.userConfig,
  (userConfig) => {
    syncDocumentLanguageAttributes(userConfig)
  },
  { immediate: true, deep: true }
)

watch(
  () => locale.value,
  () => {
    syncDocumentLanguageAttributes(ipcStore.desktopState.userConfig)
    document.title = t('app.title')
  },
  { immediate: true }
)
watch(
  () => route.path,
  (path) => {
    const mode = Object.entries(MODE_ROUTE_MAP).find(
      ([_, p]) => p === path
    )?.[0] as StartMode | undefined
    // every write goes to disk, and most navigation stays in one mode
    if (mode && mode !== ipcStore.desktopState.sessionState.lastMode) {
      void ipcStore.patchSessionState({ lastMode: mode })
    }
  }
)

// the text selected in another app when the editor was called goes into it
const capturedSelection = createCapturedSelection({
  replaceValue: (text) => editorInputStore.replaceValue(text),
  focus: () => editorInputStore.focus(),
})
// the text selected elsewhere when chat was called goes into chat attachments
const capturedChatSelection = createCapturedChatSelection({
  startChatWithAttachment: (attachment) =>
    chatStore.startChat({ attachments: [attachment] }),
  getSelectedText: () => editorInputStore.selectedText,
})
watch(
  () => [
    ipcStore.desktopState.activationId,
    ipcStore.desktopState.mode,
    ipcStore.desktopState.isWindowShown,
    ipcStore.desktopState.selectedText,
  ],
  () => {
    if (!isQuickWindow) {
      capturedSelection.apply(ipcStore.desktopState)
      capturedChatSelection.apply(ipcStore.desktopState)
    }
  }
)

onMounted(() => {
  void listenDesktop(DESKTOP_EVENTS.QUIT_REQUESTED, settingsShutdown.request)
  void listenDesktop(DESKTOP_EVENTS.QUIT_CANCELLED, settingsShutdown.cancel)
  void listenDesktop(DESKTOP_EVENTS.PLUGINS_CHANGED, () => {
    void pluginRuntime.refreshInstalledPlugins()
  })
  // a failure has been reported already; the window keeps the defaults, and
  // the store refuses to save them over the user's files
  bootstrap
    .start()
    .then(() => {
      // the quick window knows the plugin tools and always exists
      if (isQuickWindow) useDefaultCommandsStore().start()
    })
    .catch((error: unknown) => {
      // eslint-disable-next-line no-console
      console.error('App bootstrap failed', error)
      clientLogger.error('App bootstrap failed', error, 'bootstrap')
    })
  if (isQuickWindow) void activationMetrics.start()
  // the quick window always exists, shown or not, so it takes the selection
  // actions that run without a window
  if (isQuickWindow) {
    const selectionReplace = useSelectionReplaceStore()
    void listenDesktop(DESKTOP_EVENTS.SELECTION_RUN, (payload) => {
      void selectionReplace.handleRun(payload)
    })
    void listenDesktop(DESKTOP_EVENTS.SELECTION_CANCEL, (payload) => {
      selectionReplace.handleCancel(payload.runId)
    })
    const externalCommands = useExternalCommandsStore()
    void listenDesktop(DESKTOP_EVENTS.EXTERNAL_JOB_CANCEL, (id) => {
      externalCommands.handleCancel(id)
      useCommandLauncherStore().cancelExternal(id)
    })
    void listenDesktop(DESKTOP_EVENTS.COMMAND_RUN, (payload) => {
      void externalCommands.handleRun(payload)
    })
  }
  void listenDesktop(DESKTOP_EVENTS.OPEN_MAIN_CHAT, async (payload) => {
    if (isQuickWindow) return
    menuModalsStore.closeAll()
    await appNavigation.goToChat()
    const { attachment, question, autoSend } = payload
    const trimmedText = attachment?.text?.trim()
    const trimmedQuestion = question?.trim()
    if (attachment && trimmedText) {
      await chatStore.startChat({
        attachments: [{ ...attachment, text: trimmedText }],
      })
    } else if (trimmedQuestion) {
      await chatStore.startChat({})
    } else {
      await chatStore.openLastOrNewChat()
    }

    await nextTick()

    if (trimmedQuestion) {
      chatInputStore.setValue(trimmedQuestion)
      if (autoSend) {
        await chatStore.sendInput()
      } else {
        chatInputStore.focus()
      }
    }
  })
  void listenDesktop(DESKTOP_EVENTS.OPEN_MAIN_EDITOR, (payload) => {
    if (!isQuickWindow) {
      routeParamsStore.applyEditorTransfer(payload.text, payload.sourceText)
      void appNavigation.goToEditor()
    }
  })
  void listenDesktop(DESKTOP_EVENTS.MAIN_WINDOW_CLOSED, () => {
    if (!isQuickWindow) void mainWindowReset.reset()
  })
})

onUnmounted(() => {
  settingsShutdown.dispose()
  bootstrap.stop()
  runtimeScope.stop()
  void pluginRuntime.dispose()
  activationMetrics.stop()
})
</script>

<style scoped>
.shutdown-status {
  position: fixed;
  inset: 0 0 auto;
  z-index: 100;
  padding: var(--space-md);
  background: var(--app-surface-raised);
  text-align: center;
}
.layout {
  height: 100dvh;
  width: 100dvw;
  display: flex;
  flex-direction: column;
  background-color: var(--color-base-100);
}
.layout-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  min-width: 0;
}
.quick-layout {
  justify-content: flex-end;
  background: transparent;
}
.panel-layout {
  background: transparent;
}
.panel-layout .layout-body {
  justify-content: flex-end;
  padding: var(--space-sm);
}
.panel-layout .routed-layer {
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: color-mix(in oklab, var(--app-surface) 94%, transparent);
  box-shadow: var(--app-shadow-lg);
  backdrop-filter: blur(16px);
}
.main {
  flex: 1 1 0%;
  min-height: 0; /* Allow flex descendants to shrink. */
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
.quick-layout .main {
  flex: 0 1 auto;
  width: 100%;
}
.layer {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
.routed-layer {
  background-color: var(--color-base-100);
}
</style>
