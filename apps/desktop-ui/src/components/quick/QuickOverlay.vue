<template>
  <div class="quick-overlay-root" :class="isSheet ? 'is-sheet' : 'is-panel'">
    <div ref="cardRef" class="quick-overlay-card">
      <div v-show="currentMode === 'write'" class="quick-mode-layer">
        <WriteModeView />
      </div>
      <div v-show="currentMode === 'voice'" class="quick-mode-layer">
        <VoiceView />
      </div>
      <div v-show="currentMode === 'aiTasks'" class="quick-mode-layer">
        <AiTaskView />
      </div>
      <div
        v-show="currentMode === 'select' || currentMode === 'correction'"
        class="quick-mode-layer"
      >
        <SelectModeView />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import {
  QUICK_PANEL_WIDTH,
  quickPanelWindowHeight,
} from '../../lib/quick-panel/quick-panel-size'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import { useWriterInputStore } from '../../stores/writerInput'
import AiTaskView from '../../views/AiTaskView.vue'
import SelectModeView from '../../views/SelectModeView.vue'
import VoiceView from '../../views/VoiceView.vue'
import WriteModeView from '../../views/WriteModeView.vue'
import { LogicalSize } from '@tauri-apps/api/dpi'
import { getCurrentWindow } from '@tauri-apps/api/window'

const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const writerInputStore = useWriterInputStore()
const cardRef = ref<HTMLElement | null>(null)

const currentMode = computed(() => ipcStore.params?.mode || 'write')

const isSheet = computed(() => {
  return (
    currentMode.value !== 'write' ||
    menuModalsStore.currentModal !== MenuModals.NONE ||
    Boolean(menuModalsStore.pendingModal)
  )
})

let resizeObserver: ResizeObserver | null = null
let lastWindowHeight = 0

const resizeWindow = async (): Promise<void> => {
  if (!cardRef.value || isSheet.value) return

  const height = quickPanelWindowHeight(
    cardRef.value.getBoundingClientRect().height
  )
  if (height === lastWindowHeight) return

  try {
    await getCurrentWindow().setSize(new LogicalSize(QUICK_PANEL_WIDTH, height))
    lastWindowHeight = height
  } catch {
    // Browser dev fallback
  }
}

const syncFocus = () => {
  if (currentMode.value === 'write') {
    writerInputStore.focus()
  }
}

onMounted(() => {
  resizeObserver = new ResizeObserver(() => void resizeWindow())
  if (cardRef.value) resizeObserver.observe(cardRef.value)
  syncFocus()
})

onUnmounted(() => {
  resizeObserver?.disconnect()
})

watch(
  isSheet,
  async (sheet) => {
    try {
      await ipcStore.callFunction('setWindowProfile', [
        sheet ? 'sheet' : 'panel',
      ])
    } catch {
      // IPC fallback
    }
    if (!sheet) {
      lastWindowHeight = 0
      await nextTick()
      void resizeWindow()
    }
  },
  { immediate: true }
)

// Keep focus in the input field when window is shown or hidden so focus arrives immediately
watch(
  () => ipcStore.params.isWindowShown,
  () => {
    syncFocus()
  }
)

watch(
  () => currentMode.value,
  async () => {
    await nextTick()
    syncFocus()
    if (!isSheet.value) {
      void resizeWindow()
    }
  }
)
</script>

<style scoped>
.quick-overlay-root {
  height: 100dvh;
  width: 100dvw;
  background: transparent;
  display: flex;
  flex-direction: column;
  padding: var(--space-sm);
  box-sizing: border-box;
}

.quick-overlay-root.is-panel {
  justify-content: flex-end;
}

.quick-overlay-root.is-sheet {
  justify-content: center;
  align-items: center;
}

.quick-overlay-card {
  overflow: hidden;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background: color-mix(in oklab, var(--app-surface) 94%, transparent);
  box-shadow: var(--app-shadow-lg);
  backdrop-filter: blur(16px);
  display: flex;
  flex-direction: column;
  width: 100%;
}

.quick-overlay-root.is-panel .quick-overlay-card {
  max-height: 100%;
}

.quick-overlay-root.is-sheet .quick-overlay-card {
  height: 100%;
  max-height: 100%;
}

.quick-mode-layer {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  width: 100%;
}
</style>
