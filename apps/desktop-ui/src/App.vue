<template>
  <MenuModals />
  <div class="layout">
    <NavPanel v-if="navPanelStore.params.panelVisible" />
    <div class="main">
      <!-- always mounted: its input keeps the focus between activations -->
      <div v-show="quickPanelStore.isActive" class="layer">
        <QuickPanel />
      </div>
      <div v-show="!quickPanelStore.isActive" class="layer">
        <RouterView />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import { useRoute } from 'vue-router'

import { useGlobalEvents } from './composables/useGlobalEvents'
import { useI18n } from './composables/useI18n'
import { createAppBootstrap } from './lib/app/app-bootstrap'
import { desktopClient } from './lib/desktop/client'
import { syncI18nLocale } from './lib/i18n'
import { syncDocumentLanguageAttributes } from './lib/locale/language'
import { appNavigation } from './lib/navigation/navigation'
import { MODE_ROUTE_MAP } from './lib/navigation/routes'
import { usePlugins } from './plugins'
import { useIpcStore } from './stores/ipc'
import { useMenuModalsStore } from './stores/menuModals'
import { useNavPanelStore } from './stores/navPanel'
import { useQuickPanelStore } from './stores/quickPanel'
import { useThemeStore } from './stores/theme'
import { type START_MODES } from '@tyco/shared'

useThemeStore()
const ipcStore = useIpcStore()
const { locale, t } = useI18n()
const { globalEvents } = useGlobalEvents()
const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()
const quickPanelStore = useQuickPanelStore()
const route = useRoute()
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

onMounted(() => {
  void bootstrap.start()
})

onUnmounted(() => {
  bootstrap.stop()
})
</script>

<style scoped>
.layout {
  height: 100dvh;
  width: 100dvw;
  display: flex;
  flex-direction: column;
}
.main {
  flex: 1 1 0%;
  min-height: 0; /* Важно для flexbox, чтобы потомки могли сжиматься */
  display: flex;
  flex-direction: column;
  position: relative;
}
.layer {
  flex: 1 1 0%;
  min-height: 0;
  display: flex;
  flex-direction: column;
}
</style>
