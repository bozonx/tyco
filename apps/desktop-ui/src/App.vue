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
import ToastContainer from './components/common/ToastContainer.vue'
import QuickOverlay from './components/quick/QuickOverlay.vue'
import { useAppRuntime } from './composables/use-app-runtime'

const { settingsShutdown, t, isQuickWindow, navPanelStore } = useAppRuntime()
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
.main {
  flex: 1 1 0%;
  min-height: 0; /* Allow flex descendants to shrink. */
  min-width: 0;
  display: flex;
  flex-direction: column;
  position: relative;
}
</style>
