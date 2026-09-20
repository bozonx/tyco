<template>
  <MenuModals />
  <div class="layout">
    <NavPanel v-if="navPanelStore.params.panelVisible" />
    <div class="main">
      <RouterView />
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
import { usePlugins } from './plugins'
import { useIpcStore } from './stores/ipc'
import { useMenuModalsStore } from './stores/menuModals'
import { useNavPanelStore } from './stores/navPanel'
import { useThemeStore } from './stores/theme'
import { START_MODES } from '@shared'
import { MODE_ROUTE_MAP } from './lib/navigation/routes'

useThemeStore()
const ipcStore = useIpcStore()
const { locale, t } = useI18n()
const { globalEvents } = useGlobalEvents()
const menuModalsStore = useMenuModalsStore()
const navPanelStore = useNavPanelStore()
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
    usePlugins()
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
</style>
