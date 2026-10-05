<template>
  <MenuModals />
  <template v-if="isQuickWindow">
    <QuickOverlay />
  </template>
  <template v-else>
    <div class="layout">
      <NavPanel v-if="navPanelStore.params.panelVisible" />
      <div class="main">
        <RouterView />
      </div>
    </div>
  </template>
  <ToastContainer />
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import ToastContainer from './components/common/ToastContainer.vue'
import QuickOverlay from './components/quick/QuickOverlay.vue'
import { useChatVoiceInput } from './composables/useChatVoiceInput'
import { GlobalEvents, useGlobalEvents } from './composables/useGlobalEvents'
import { useI18n } from './composables/useI18n'
import { createActivationMetricsClient } from './lib/activation-metrics/activation-metrics'
import { createAppBootstrap } from './lib/app/app-bootstrap'
import { createMainWindowReset } from './lib/app/main-window-reset'
import { createCapturedChatSelection } from './lib/chat/captured-chat-selection'
import { createVoiceChatActivation } from './lib/chat/voice-chat-activation'
import { desktopClient } from './lib/desktop/client'
import { createCapturedSelection } from './lib/editor-input/captured-selection'
import { syncI18nLocale } from './lib/i18n'
import { syncDocumentLanguageAttributes } from './lib/locale/language'
import { appNavigation } from './lib/navigation/navigation'
import { MODE_ROUTE_MAP } from './lib/navigation/routes'
import { usePlugins } from './plugins'
import { useChatStore } from './stores/chat'
import { useDefaultCommandsStore } from './stores/commands'
import { useEditorInputStore } from './stores/editorInput'
import { useExternalCommandsStore } from './stores/externalCommands'
import { useIpcStore } from './stores/ipc'
import { useMenuModalsStore } from './stores/menuModals'
import { useNavPanelStore } from './stores/navPanel'
import { useRouteParams } from './stores/routeParams'
import { useSelectionReplaceStore } from './stores/selectionReplace'
import { useThemeStore } from './stores/theme'
import { useToolCatalogStore } from './stores/tools'
import { useWriterInputStore } from './stores/writerInput'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { type START_MODES } from '@tyco/shared'
import { type EditorTransfer } from '@tyco/shared'
import { DESKTOP_EVENTS } from '@tyco/shared'

useThemeStore()
const ipcStore = useIpcStore()
const { locale, t } = useI18n()
const { globalEvents } = useGlobalEvents()
const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()
const chatStore = useChatStore()
const editorInputStore = useEditorInputStore()
const writerInputStore = useWriterInputStore()
const routeParamsStore = useRouteParams()
const route = useRoute()
const isQuickWindow = getCurrentWindow().label === 'quick'
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
      writerInputStore.value,
    ])
  },
  prepareTrial: () => writerInputStore.clear(),
  activeElement: () => document.activeElement,
  requestFrame: (handler) => requestAnimationFrame(handler),
  eventTarget: document,
})
if (typeof document !== 'undefined') {
  document.documentElement.dataset.window = isQuickWindow ? 'quick' : 'main'
}
const selectionListeners: (() => void)[] = []
let removeMainChatListener: (() => void) | undefined
let removeMainEditorListener: (() => void) | undefined
let removeMainClosedListener: (() => void) | undefined
const mainWindowReset = createMainWindowReset({
  closeAllModals: () => menuModalsStore.closeAll(),
  goToEditor: () => appNavigation.goToEditor(),
})
const bootstrap = createAppBootstrap({
  loadInitialParams: () => ipcStore.loadInitialParams(),
  setParams: (params) => ipcStore.setParams(params),
  closeAllModals: () => menuModalsStore.closeAll(),
  navigateTo: (path) => appNavigation.push(path),
  listen: (event, handler) =>
    desktopClient.listen(event as never, handler as never),
  emitGlobal: (event, payload) => globalEvents.emit(event, payload),
  initPlugins: () => {
    usePlugins().reloadPlugins()
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
  () => ipcStore.params?.userConfig?.plugins,
  (plugins) => {
    usePlugins().reloadPlugins({ plugins } as any)
  },
  { deep: true }
)

watch(
  () => [
    ipcStore.params.userConfig?.appLanguage,
    ipcStore.params.userConfig?.userLanguage,
  ],
  ([appLanguage, userLanguage]) => {
    syncI18nLocale(appLanguage, userLanguage)
  },
  { immediate: true }
)

watch(
  () => ipcStore.params.userConfig,
  (userConfig) => {
    syncDocumentLanguageAttributes(userConfig)
  },
  { immediate: true, deep: true }
)

watch(
  () => locale.value,
  () => {
    syncDocumentLanguageAttributes(ipcStore.params.userConfig)
    document.title = t('app.title')
  },
  { immediate: true }
)
watch(
  () => route.path,
  (path) => {
    const mode = Object.entries(MODE_ROUTE_MAP).find(
      ([_, p]) => p === path
    )?.[0] as START_MODES | undefined
    // every write goes to disk, and most navigation stays in one mode
    if (mode && mode !== ipcStore.params.localState.lastMode) {
      void ipcStore.patchLocalState({ lastMode: mode })
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
  startChatWithAttachment: (text) => chatStore.attachToChat(text),
  getSelectedText: () => editorInputStore.selectedText,
})
// the voice chat hotkey opens a dictation into the chat with the selection as
// its context, then submits it
const { isVoiceInputOpen, openChatVoiceInput } = useChatVoiceInput()
const voiceChatActivation = createVoiceChatActivation({
  isVoiceInputOpen,
  currentPath: () => appNavigation.currentPath(),
  navigateTo: (path) => appNavigation.push(path),
  closeAllModals: () => menuModalsStore.closeAll(),
  openQuickVoiceInput: () => openChatVoiceInput({ quickSend: true }),
  submitVoiceInput: () => globalEvents.emit(GlobalEvents.VOICE_SUBMIT),
  attachSelection: (text) => chatStore.addAttachment(text),
})
watch(
  () => [
    ipcStore.params.activationId,
    ipcStore.params.mode,
    ipcStore.params.isWindowShown,
    ipcStore.params.selectedText,
  ],
  () => {
    if (!isQuickWindow) {
      capturedSelection.apply(ipcStore.params)
      capturedChatSelection.apply(ipcStore.params)
      void voiceChatActivation.apply(ipcStore.params)
    }
  }
)

// the texts outlive a hidden window, but not a quit or a crash
watch(
  () => ipcStore.params.isWindowShown,
  (isShown) => {
    if (isShown) return

    void editorInputStore.snapshotDraft()
    void writerInputStore.snapshotDraft()
  }
)

onMounted(() => {
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
    })
  if (isQuickWindow) void activationMetrics.start()
  // the quick window always exists, shown or not, so it takes the selection
  // actions that run without a window
  if (isQuickWindow) {
    const selectionReplace = useSelectionReplaceStore()
    void desktopClient
      .listen(DESKTOP_EVENTS.SELECTION_RUN, (payload) => {
        void selectionReplace.handleRun(payload)
      })
      .then((remove) => selectionListeners.push(remove))
    void desktopClient
      .listen(DESKTOP_EVENTS.SELECTION_CANCEL, (payload) => {
        selectionReplace.handleCancel(payload.runId)
      })
      .then((remove) => selectionListeners.push(remove))
    const externalCommands = useExternalCommandsStore()
    void desktopClient
      .listen(DESKTOP_EVENTS.COMMAND_RUN, (payload) => {
        void externalCommands.handleRun(payload)
      })
      .then((remove) => selectionListeners.push(remove))
  }
  void desktopClient
    .listen(DESKTOP_EVENTS.OPEN_MAIN_CHAT, (payload) => {
      if (isQuickWindow) return
      menuModalsStore.closeAll()
      const { text } = payload as { text?: string }
      void (text ? chatStore.attachToChat(text) : chatStore.openLastOrNewChat())
    })
    .then((remove) => {
      removeMainChatListener = remove
    })
  void desktopClient
    .listen(DESKTOP_EVENTS.OPEN_MAIN_EDITOR, (payload) => {
      if (!isQuickWindow) {
        const transfer = payload as EditorTransfer
        routeParamsStore.applyEditorTransfer(transfer.text, transfer.sourceText)
        void appNavigation.goToEditor()
      }
    })
    .then((remove) => {
      removeMainEditorListener = remove
    })
  void desktopClient
    .listen(DESKTOP_EVENTS.MAIN_WINDOW_CLOSED, () => {
      if (!isQuickWindow) void mainWindowReset.reset()
    })
    .then((remove) => {
      removeMainClosedListener = remove
    })
})

onUnmounted(() => {
  bootstrap.stop()
  activationMetrics.stop()
  removeMainEditorListener?.()
  removeMainClosedListener?.()
  removeMainChatListener?.()
  selectionListeners.forEach((remove) => remove())
})
</script>

<style scoped>
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
  min-height: 0; /* Важно для flexbox, чтобы потомки могли сжиматься */
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
