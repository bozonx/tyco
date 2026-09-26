<template>
  <div
    class="quick-overlay-root"
    :class="[isSheet ? 'is-sheet' : 'is-panel', { 'has-modal': hasModal }]"
    @pointerdown="handleRootPointerDown"
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
import {
  type InputRect,
  createInputRegionSync,
  inputRegion,
  unionRect,
} from '../../lib/quick-panel/input-region'
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

/** What stays clickable while only the input is shown. */
const INPUT_PARTS = '.write-frame, .write-hint'

const QUICK_MODES = ['write', 'voice', 'select', 'aiTasks', 'correction']

/**
 * The step after the input (its actions, a correction on its way) stays until
 * the user closes it with Esc: a click elsewhere must not lose it
 */
const isWriteFollowUp = computed(
  () =>
    currentMode.value === 'write' &&
    (hasModal.value || Boolean(menuModalsStore.pendingModal))
)

/** The user clicked elsewhere: drop what is in progress, keep the text. */
const dismiss = () => {
  if (currentMode.value === 'write') writerInputStore.markDismissed()
  menuModalsStore.cancelPending()
  menuModalsStore.closeAll()
  void ipcStore.callFunction('dismissQuickWindow', []).catch(() => {})
}

const handleRootPointerDown = (event: PointerEvent) => {
  if (!cardRef.value || isWriteFollowUp.value) return
  const target = event.target as Node | null
  if (
    currentMode.value === 'write' &&
    cardRef.value.querySelector('.write-frame')
  ) {
    const isInputPart = Array.from(
      cardRef.value.querySelectorAll(INPUT_PARTS)
    ).some((part) => target && part.contains(target))
    if (target && !isInputPart) dismiss()
    return
  }
  if (target && !cardRef.value.contains(target)) {
    dismiss()
  }
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
    !isWriteFollowUp.value &&
    ipcStore.params.userConfig?.quickHideOnBlur !== false &&
    !quickDismissStore.isHeld,
  onLost: dismiss,
})
let removeFocusListener: (() => void) | undefined
let unmounted = false

// The window keeps one size; while it shows only the input, the rest of it
// lets clicks through to the windows below
const regionSync = createInputRegionSync({
  apply: async (region) => {
    const result = await ipcStore.callFunction('setQuickInputRegion', [region])
    if (!result.success) throw new Error(result.error)
  },
})

const measureInputRegion = (): InputRect | null => {
  if (isSheet.value || !ipcStore.params.isWindowShown || !cardRef.value) {
    return null
  }
  const rects = Array.from(cardRef.value.querySelectorAll(INPUT_PARTS))
    .map((element) => element.getBoundingClientRect())
    .filter((rect) => rect.width > 0 && rect.height > 0)
    .map(({ x, y, width, height }) => ({ x, y, width, height }))
  return inputRegion(unionRect(rects), {
    width: window.innerWidth,
    height: window.innerHeight,
  })
}

const updateInputRegion = () => {
  void regionSync.update(measureInputRegion()).catch(() => {})
}

const updateInputRegionAfterRender = () => {
  void nextTick(updateInputRegion)
}

let inputResizeObserver: ResizeObserver | undefined

const syncFocus = () => {
  if (currentMode.value === 'write') {
    writerInputStore.focus()
  }
}

onMounted(() => {
  syncFocus()
  inputResizeObserver = new ResizeObserver(updateInputRegion)
  cardRef.value
    ?.querySelectorAll(INPUT_PARTS)
    .forEach((element) => inputResizeObserver?.observe(element))
  window.addEventListener('resize', updateInputRegion)
  updateInputRegionAfterRender()
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
  inputResizeObserver?.disconnect()
  window.removeEventListener('resize', updateInputRegion)
  regionSync.dispose()
  focusLoss.dispose()
  removeFocusListener?.()
})

// whatever hid the window, work started for it has no one to show it to
watch(
  () => ipcStore.params.isWindowShown,
  (isShown) => {
    if (isShown) return
    menuModalsStore.cancelPending()
    // a correction must not finish into an insert nobody sees
    menuModalsStore.closeAll()
  }
)

// every activation starts with the whole window taking clicks
watch(
  () => ipcStore.params.activationId,
  () => regionSync.invalidate()
)

watch(
  [
    isSheet,
    () => ipcStore.params.isWindowShown,
    () => ipcStore.params.activationId,
  ],
  updateInputRegionAfterRender
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

watch(hasModal, (open) => {
  if (!open) {
    void nextTick(() => syncFocus())
  }
})
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
  height: 100%;
  max-height: 100%;
  justify-content: flex-end;
  overflow: visible;
}

.quick-overlay-root.is-sheet .quick-overlay-card {
  height: 100%;
  max-height: 100%;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  box-shadow: var(--app-shadow-lg);
  background: var(--app-surface);
  backdrop-filter: none;
}

.quick-overlay-root.has-modal .quick-overlay-card {
  visibility: hidden;
}

.quick-mode-layer {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  flex: 1 1 0%;
  min-height: 0;
  width: 100%;
  height: 100%;
}
</style>
