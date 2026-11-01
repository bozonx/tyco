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
  <UserDataMissingScreen v-else-if="isUserDataMissing" />
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
import { computed } from 'vue'

import NavPanel from './components/app/NavPanel.vue'
import UserDataMissingScreen from './components/app/UserDataMissingScreen.vue'
import ToastContainer from './components/common/ToastContainer.vue'
import MenuModals from './components/menu/MenuModals.vue'
import QuickOverlay from './components/quick/QuickOverlay.vue'
import { useAppRuntime } from './composables/use-app-runtime'
import { useDesktopStore } from './stores/desktop'

const { settingsShutdown, t, isQuickWindow, navPanelStore } = useAppRuntime()
const desktop = useDesktopStore()
/** The chosen data folder is not there: nothing else can work */
const isUserDataMissing = computed(
  () => desktop.userData.status === 'notConnected'
)
</script>

<style scoped>
.shutdown-status {
  position: fixed;
  inset: 0 0 auto;
  z-index: var(--z-overlay);
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
.main {
  flex: 1 1 0%;
  min-height: 0; /* Allow flex descendants to shrink. */
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
</style>
