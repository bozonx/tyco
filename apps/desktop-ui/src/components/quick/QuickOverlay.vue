<template>
  <div
    class="quick-overlay-root"
    :class="[isSheet ? 'is-sheet' : 'is-panel', { 'has-modal': hasModal }]"
  >
    <div ref="cardRef" class="quick-overlay-card">
      <div v-show="currentMode === 'write'" class="quick-mode-layer">
        <WriteModeView />
      </div>
      <div v-show="currentMode === 'voice'" class="quick-mode-layer">
        <VoiceView
          v-if="currentMode === 'voice' && ipcStore.params.isWindowShown"
        />
      </div>
      <div v-show="currentMode === 'aiTasks'" class="quick-mode-layer">
        <AiTaskView
          v-if="currentMode === 'aiTasks' && ipcStore.params.isWindowShown"
        />
      </div>
      <div
        v-show="currentMode === 'select' || currentMode === 'correction'"
        class="quick-mode-layer"
      >
        <SelectModeView
          v-if="
            (currentMode === 'select' || currentMode === 'correction') &&
            ipcStore.params.isWindowShown
          "
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { createFocusLossWatcher } from '../../lib/quick-panel/focus-loss'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menuModals'
import { useQuickDismissStore } from '../../stores/quickDismiss'
import { useWriterInputStore } from '../../stores/writerInput'
import AiTaskView from '../../views/AiTaskView.vue'
import SelectModeView from '../../views/SelectModeView.vue'
import VoiceView from '../../views/VoiceView.vue'
import WriteModeView from '../../views/WriteModeView.vue'
import { getCurrentWindow } from '@tauri-apps/api/window'

const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const writerInputStore = useWriterInputStore()
const quickDismissStore = useQuickDismissStore()
const cardRef = ref<HTMLElement | null>(null)

const currentMode = computed(() => ipcStore.params?.mode || 'write')
const hasModal = computed(
  () => menuModalsStore.currentModal !== MenuModals.NONE
)

const isSheet = computed(() => {
  return (
    currentMode.value !== 'write' ||
    menuModalsStore.currentModal !== MenuModals.NONE ||
    Boolean(menuModalsStore.pendingModal)
  )
})

let windowUpdate = Promise.resolve()

const queueWindowUpdate = (update: () => Promise<void>): Promise<void> => {
  windowUpdate = windowUpdate.then(update, update)
  return windowUpdate
}

const QUICK_MODES = ['write', 'voice', 'select', 'aiTasks', 'correction']

/** The user clicked elsewhere: drop what is in progress, keep the text. */
const dismiss = () => {
  if (currentMode.value === 'write') writerInputStore.markDismissed()
  menuModalsStore.cancelPending()
  menuModalsStore.closeAll()
  void ipcStore.callFunction('dismissQuickWindow', []).catch(() => {})
}

const focusLoss = createFocusLossWatcher({
  isFocused: async () => {
    const window = getCurrentWindow()
    // a hidden window has nothing to dismiss
    return !(await window.isVisible()) || (await window.isFocused())
  },
  canDismiss: () =>
    Boolean(ipcStore.params.isWindowShown) &&
    QUICK_MODES.includes(currentMode.value) &&
    ipcStore.params.userConfig?.quickHideOnBlur !== false &&
    !quickDismissStore.isHeld,
  onLost: dismiss,
})
let removeFocusListener: (() => void) | undefined
let unmounted = false

const syncFocus = () => {
  if (currentMode.value === 'write') {
    writerInputStore.focus()
  }
}

onMounted(() => {
  syncFocus()
  void getCurrentWindow()
    .onFocusChanged(({ payload }) => focusLoss.handleFocusChange(payload))
    .then((remove) => {
      if (unmounted) remove()
      else removeFocusListener = remove
    })
    .catch(() => {})
})

onUnmounted(() => {
  unmounted = true
  focusLoss.dispose()
  removeFocusListener?.()
})

// whatever hid the window, work started for it has no one to show it to
watch(
  () => ipcStore.params.isWindowShown,
  (isShown) => {
    if (!isShown) menuModalsStore.cancelPending()
  }
)

watch(
  isSheet,
  (sheet) => {
    void queueWindowUpdate(async () => {
      try {
        // the remap to the new size blurs the window for a moment
        await focusLoss.suppress(() =>
          ipcStore.callFunction('setWindowProfile', [sheet ? 'sheet' : 'panel'])
        )
      } catch {
        // IPC fallback
      }
    })
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
  display: flex;
  flex-direction: column;
  width: 100%;
}

.quick-overlay-root.is-panel .quick-overlay-card {
  background: transparent;
  border: none;
  box-shadow: none;
  backdrop-filter: none;
  max-height: 100%;
}

.quick-overlay-root.is-sheet .quick-overlay-card {
  height: 100%;
  max-height: 100%;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
  background: var(--app-overlay-bg);
  backdrop-filter: blur(16px);
}

.quick-overlay-root.has-modal .quick-overlay-card {
  visibility: hidden;
}

.quick-mode-layer {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  width: 100%;
}
</style>
