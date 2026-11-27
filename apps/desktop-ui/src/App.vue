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
  <ConfirmModal
    v-if="toolApproval"
    :key="toolApproval.approvalId"
    :open="true"
    :title="t('chat.toolApprovalQuestion', { tool: toolApproval.toolName })"
    :message="
      toolApproval.leakTarget ?? (JSON.stringify(toolApproval.input) || '')
    "
    :confirm-text="t('chat.toolAllow')"
    :cancel-text="t('chat.toolDeny')"
    @confirm="answerTool('allow-once')"
    @cancel="answerTool('deny')"
  />
  <ImageViewerDialog
    :open="imageViewer.isOpen"
    :src="imageViewer.src"
    :alt="imageViewer.alt"
    :light-surface="imageViewer.lightSurface"
    @close="imageViewer.close()"
  />
</template>

<script setup lang="ts">
import { computed } from 'vue'

import NavPanel from './components/app/NavPanel.vue'
import UserDataMissingScreen from './components/app/UserDataMissingScreen.vue'
import ConfirmModal from './components/common/ConfirmModal.vue'
import ImageViewerDialog from './components/common/ImageViewerDialog.vue'
import ToastContainer from './components/common/ToastContainer.vue'
import MenuModals from './components/menu/MenuModals.vue'
import QuickOverlay from './components/quick/QuickOverlay.vue'
import { useAppRuntime } from './composables/use-app-runtime'
import { useDesktopStore } from './stores/desktop'
import { useImageViewerStore } from './stores/image-viewer'
import { useOperationsStore } from './stores/operations'

const { settingsShutdown, t, isQuickWindow, navPanelStore } = useAppRuntime()
const desktop = useDesktopStore()
const imageViewer = useImageViewerStore()
const operations = useOperationsStore()
const toolApproval = computed(() => operations.pendingToolApprovals[0])
function answerTool(decision: 'allow-once' | 'deny') {
  if (toolApproval.value)
    operations.answerToolApproval(toolApproval.value.approvalId, decision)
}
/** The data folder is not there or not set up yet: nothing else can work */
const isUserDataMissing = computed(
  () =>
    desktop.userData.status === 'notConnected' ||
    desktop.userData.status === 'notInitialized'
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
