<template>
  <MenuModals />
  <div
    class="layout"
    :class="{
      'quick-layout': quickPanelStore.isActive && ipcStore.params.quickInput,
    }"
  >
    <WindowTitlebar v-if="isQuickWindow && sheetTitle" :title="sheetTitle" />
    <div class="layout-body">
      <NavPanel
        v-if="
          navPanelStore.params.panelVisible &&
          !(quickPanelStore.isActive && ipcStore.params.quickInput)
        "
      />
      <div class="main">
        <!-- always mounted: its input keeps the focus between activations -->
        <div v-show="quickPanelStore.isActive" class="layer">
          <QuickPanel />
        </div>
        <div v-show="!quickPanelStore.isActive" class="layer routed-layer">
          <RouterView />
        </div>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import WindowTitlebar from './components/WindowTitlebar.vue'
import { useGlobalEvents } from './composables/useGlobalEvents'
import { useI18n } from './composables/useI18n'
import { createActivationMetricsClient } from './lib/activation-metrics/activation-metrics'
import { createAppBootstrap } from './lib/app/app-bootstrap'
import { desktopClient } from './lib/desktop/client'
import { syncI18nLocale } from './lib/i18n'
import { syncDocumentLanguageAttributes } from './lib/locale/language'
import { appNavigation } from './lib/navigation/navigation'
import { MODE_ROUTE_MAP } from './lib/navigation/routes'
import { sheetTitleKey } from './lib/window-profile/window-profile'
import { usePlugins } from './plugins'
import { useEditorInputStore } from './stores/editorInput'
import { useIpcStore } from './stores/ipc'
import { useMenuModalsStore } from './stores/menuModals'
import { useNavPanelStore } from './stores/navPanel'
import { useQuickPanelStore } from './stores/quickPanel'
import { useRouteParams } from './stores/routeParams'
import { useThemeStore } from './stores/theme'
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
const quickPanelStore = useQuickPanelStore()
const editorInputStore = useEditorInputStore()
const writerInputStore = useWriterInputStore()
const routeParamsStore = useRouteParams()
const route = useRoute()
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
      editorInputStore.value,
    ])
  },
  prepareTrial: () => editorInputStore.clear(),
  activeElement: () => document.activeElement,
  requestFrame: (handler) => requestAnimationFrame(handler),
  eventTarget: document,
})
const isQuickWindow = getCurrentWindow().label === 'quick'
let removeMainEditorListener: (() => void) | undefined
const sheetTitle = computed(() => {
  const key = sheetTitleKey(route.path)
  return key ? t(key) : ''
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
  },
  handleNavKeyUp: (event) => navPanelStore.handleKeyUp(event),
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
    if (mode) {
      void ipcStore.patchLocalState({ lastMode: mode })
    }
  }
)

// the quick panel is outside the router, so entering and leaving it is driven
// by the route instead of by mount and unmount hooks
watch(
  () => route.path,
  (path) => {
    quickPanelStore.syncRoute(path)
  },
  { immediate: true }
)

// a hidden panel has to keep the focus in its field: the compositor hands the
// keyboard over before the frontend learns about the next show
watch(
  () => ipcStore.params.isWindowShown,
  () => {
    quickPanelStore.syncWindowVisibility()
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
  void bootstrap.start()
  void activationMetrics.start()
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
})

onUnmounted(() => {
  bootstrap.stop()
  activationMetrics.stop()
  removeMainEditorListener?.()
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
