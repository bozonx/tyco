<template>
  <div
    class="quick-overlay-root"
    :class="[isSheet ? 'is-sheet' : 'is-panel', { 'has-modal': hasModal }]"
    @pointerdown="handleRootPointerDown"
  >
    <!-- without decorations nothing else tells that the keys go elsewhere -->
    <div
      v-if="showFocusHint"
      class="quick-focus-hint"
      role="status"
      aria-live="polite"
    >
      {{ t('window.clickToFocus') }}
    </div>
    <div ref="cardRef" class="quick-overlay-card">
      <div v-show="currentMode === 'write'" class="quick-mode-layer">
        <WriteView />
      </div>
      <div v-show="currentMode === 'voice'" class="quick-mode-layer">
        <VoiceView
          v-if="
            currentMode === 'voice' && desktopStore.desktopState.isWindowShown
          "
          bar
          @result-shown="voiceResultShown = $event"
        />
      </div>
      <!-- Hiding preserves the view until its next activation. A new activation
           remounts action menus to clear their previous query and language. -->
      <div v-show="currentMode === 'aiTasks'" class="quick-mode-layer">
        <AiTaskView v-if="currentMode === 'aiTasks'" :key="activationId" />
      </div>
      <div v-show="currentMode === 'select'" class="quick-mode-layer">
        <SelectionView v-if="currentMode === 'select'" :key="activationId" />
      </div>
      <div v-show="currentMode === 'commandLauncher'" class="quick-mode-layer">
        <CommandLauncherView
          v-if="currentMode === 'commandLauncher'"
          :key="activationId"
        />
      </div>
      <div
        v-if="
          currentMode === 'voiceCommands' &&
          desktopStore.desktopState.isWindowShown
        "
        class="quick-mode-layer"
      >
        <VoiceCommandsView :key="activationId" />
      </div>
      <div v-show="currentMode === 'correction'" class="quick-mode-layer">
        <CorrectionView
          v-if="currentMode === 'correction'"
          :key="activationId"
        />
      </div>
      <div v-show="currentMode === 'translate'" class="quick-mode-layer">
        <TranslateView v-if="currentMode === 'translate'" :key="activationId" />
      </div>
      <div v-show="currentMode === 'voiceChat'" class="quick-mode-layer">
        <VoiceChatView v-if="currentMode === 'voiceChat'" />
      </div>
      <!-- gone with the window: a prompt hidden without an answer denies -->
      <div v-show="currentMode === 'externalAccess'" class="quick-mode-layer">
        <ExternalAccessView
          v-if="
            currentMode === 'externalAccess' &&
            desktopStore.desktopState.isWindowShown
          "
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useQuickWindowSession } from '../../composables/use-quick-window-session'
import { getDesktopWindow as getCurrentWindow } from '../../lib/desktop/window'
import { createFocusLossWatcher } from '../../lib/quick-panel/focus-loss'
import {
  type InputRect,
  createInputRegionSync,
  inputRegion,
  unionRect,
} from '../../lib/quick-panel/input-region'
import { createWindowFocus } from '../../lib/quick-panel/window-focus'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickInputStore } from '../../stores/quick-input'
import AiTaskView from '../../views/AiTaskView.vue'
import CommandLauncherView from '../../views/CommandLauncherView.vue'
import CorrectionView from '../../views/CorrectionView.vue'
import ExternalAccessView from '../../views/ExternalAccessView.vue'
import SelectionView from '../../views/SelectionView.vue'
import TranslateView from '../../views/TranslateView.vue'
import VoiceChatView from '../../views/VoiceChatView.vue'
import VoiceCommandsView from '../../views/VoiceCommandsView.vue'
import VoiceView from '../../views/VoiceView.vue'
import WriteView from '../../views/WriteView.vue'

const ipcStore = useIpcStore()
const desktopStore = useDesktopStore()
const menuModalsStore = useMenuModalsStore()
const quickInputStore = useQuickInputStore()
const cardRef = ref<HTMLElement | null>(null)
const { t } = useI18n()

const currentMode = computed(() => desktopStore.desktopState?.mode || 'write')
const activationId = computed(() => desktopStore.desktopState.activationId)
const hasModal = computed(
  () => menuModalsStore.currentModal !== MenuModals.NONE
)

/** The dictation is over: its result takes the whole window */
const voiceResultShown = ref(false)

/** Modes shown as a panel at the bottom while nothing else is open */
const isPanelMode = computed(
  () =>
    currentMode.value === 'write' ||
    (currentMode.value === 'voice' && !voiceResultShown.value)
)

const isSheet = computed(() => {
  return (
    !isPanelMode.value ||
    menuModalsStore.currentModal !== MenuModals.NONE ||
    Boolean(menuModalsStore.pendingModal)
  )
})

/** What stays clickable while only the input or the voice bar is shown. */
const INPUT_PARTS = '.write-frame, .write-hint, .voice-bar'

// The window keeps one size; while it shows only the input, the rest of it
// lets clicks through to the windows below
const regionSync = createInputRegionSync({
  apply: async (region) => {
    const result = await ipcStore.callFunction('setQuickInputRegion', [region])
    if (!result.success) throw new Error(result.error)
  },
})

// a new activation owns its own operations, results and input region
const session = useQuickWindowSession({
  onActivation: () => regionSync.invalidate(),
})
const keepsOnFocusLoss = computed(session.keepsOnFocusLoss)

const handleRootPointerDown = (event: PointerEvent) => {
  // a click around the input lands in this window; a menu takes them all
  if (!cardRef.value || isSheet.value || keepsOnFocusLoss.value) return
  const target = event.target as Node | null
  if (!cardRef.value.querySelector('.write-frame')) return
  const isInputPart = Array.from(
    cardRef.value.querySelectorAll(INPUT_PARTS)
  ).some((part) => target && part.contains(target))
  if (target && !isInputPart) session.dismiss()
}

const focusLoss = createFocusLossWatcher({
  isFocused: async () => {
    const window = getCurrentWindow()
    // a hidden window has nothing to dismiss
    return !(await window.isVisible()) || (await window.isFocused())
  },
  canDismiss: session.canDismissOnFocusLoss,
  onLost: session.dismiss,
})
let removeFocusListener: (() => void) | undefined

const isWindowFocused = ref(true)
const windowFocus = createWindowFocus({
  isFocused: () => getCurrentWindow().isFocused(),
  onChange: (focused) => {
    isWindowFocused.value = focused
  },
})
// the modal menus render outside this component, so the mark goes on the root
watch(
  isWindowFocused,
  (focused) => {
    document.documentElement.dataset.windowFocused = String(focused)
  },
  { immediate: true }
)
/** The input alone shows it by its frame; a hint there would cover the page. */
const showFocusHint = computed(
  () =>
    !isWindowFocused.value &&
    isSheet.value &&
    Boolean(desktopStore.desktopState.isWindowShown)
)
let unmounted = false

const measureInputRegion = (): InputRect | null => {
  if (
    isSheet.value ||
    !desktopStore.desktopState.isWindowShown ||
    !cardRef.value
  ) {
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

function observeInputParts() {
  inputResizeObserver?.disconnect()
  cardRef.value
    ?.querySelectorAll(INPUT_PARTS)
    .forEach((element) => inputResizeObserver?.observe(element))
}

const syncFocus = () => {
  if (currentMode.value === 'write') {
    quickInputStore.requestFocus()
  }
}

onMounted(() => {
  syncFocus()
  inputResizeObserver = new ResizeObserver(updateInputRegion)
  observeInputParts()
  window.addEventListener('resize', updateInputRegion)
  updateInputRegionAfterRender()
  void getCurrentWindow()
    .onFocusChanged(({ payload }) => {
      windowFocus.handleFocusChange(payload)
      focusLoss.handleFocusChange(payload)
    })
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
  windowFocus.dispose()
  removeFocusListener?.()
  delete document.documentElement.dataset.windowFocused
})

watch([currentMode, () => desktopStore.desktopState.isWindowShown], () => {
  void nextTick(observeInputParts)
})

watch(
  [
    isSheet,
    // the input and the voice bar are both panels, of different sizes
    currentMode,
    () => desktopStore.desktopState.isWindowShown,
    () => desktopStore.desktopState.activationId,
  ],
  updateInputRegionAfterRender
)

// Keep focus in the input field when window is shown or hidden so focus arrives immediately
watch(
  () => desktopStore.desktopState.isWindowShown,
  (isShown) => {
    syncFocus()
    if (isShown) void windowFocus.refresh()
  }
)

watch(
  () => currentMode.value,
  async () => {
    await nextTick()
    syncFocus()
  }
)

watch(
  [hasModal, () => Boolean(menuModalsStore.pendingModal)],
  ([open, pending]) => {
    if (!open && !pending) {
      void nextTick(() => syncFocus())
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
  box-shadow: none;
  background: var(--app-surface);
  backdrop-filter: none;
}

.quick-overlay-root.is-sheet .quick-overlay-card,
:global([data-window='quick'] .overlay) {
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast),
    opacity var(--transition-fast);
}

/* The window has no title bar: its frame tells whether it takes the keys */
:global(
  [data-window='quick'][data-window-focused='true']
    .overlay:not(:has(.overlay-panel.is-compact))
),
:global(
  [data-window-focused='true'] .quick-overlay-root.is-sheet .quick-overlay-card
) {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  box-shadow: 0 0 0 2px
    color-mix(in oklab, var(--color-primary) 16%, transparent);
}

:global([data-window='quick'][data-window-focused='false'] .overlay),
:global(
  [data-window-focused='false'] .quick-overlay-root.is-sheet .quick-overlay-card
),
:global([data-window-focused='false'] .write-frame),
:global([data-window-focused='false'] .write-hint),
:global([data-window-focused='false'] .voice-bar) {
  opacity: 0.72;
}

/* a caret left in the input does not mean the keys go there */
:global([data-window-focused='false'] .write-frame:focus-within) {
  border-color: var(--app-border);
  box-shadow: var(--app-shadow-md);
}

.quick-focus-hint {
  position: fixed;
  top: calc(var(--space-sm) + var(--space-md));
  left: 50%;
  z-index: var(--z-toast);
  transform: translateX(-50%);
  padding: 0.375rem 0.875rem;
  border: 1px solid color-mix(in oklab, var(--color-primary) 55%, transparent);
  border-radius: var(--radius-lg);
  background-color: var(--app-surface);
  box-shadow: var(--app-shadow-md);
  font-size: var(--text-control);
  color: var(--color-base-content);
  /* the click goes to the window below the hint and gives it the focus */
  pointer-events: none;
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
