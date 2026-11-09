<template>
  <div
    class="quick-overlay-root"
    :class="[
      isSheet ? 'is-sheet' : 'is-panel',
      {
        'has-modal': hasModal,
        'is-hidden':
          !desktopStore.desktopState.isWindowShown || isAwaitingCaptureOutcome,
        'is-selecting-area': Boolean(activeAreaSelection),
      },
    ]"
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
    <ScreenshotSelector
      v-if="activeAreaSelection"
      :selection="activeAreaSelection"
      @confirm="onConfirmCrop"
      @cancel="onCancelCrop"
      @failed="onSelectorFailed"
    />
    <div
      v-show="!activeAreaSelection"
      ref="cardRef"
      class="quick-overlay-card"
      :inert="Boolean(activeAreaSelection) || isAwaitingCaptureOutcome"
    >
      <!-- the bars carry their own grip; a sheet is moved by this one -->
      <OverlayDragHandle v-if="isSheet" class="quick-sheet-drag-handle" />
      <div v-show="currentMode === 'quickInput'" class="quick-mode-layer">
        <WriteView />
      </div>
      <div v-show="currentMode === 'voice'" class="quick-mode-layer">
        <VoiceView
          v-if="currentMode === 'voice'"
          bar
          @result-shown="voiceResultShown = $event"
        />
      </div>
      <!-- each activation listens anew, from the source of its hotkey -->
      <div
        v-if="
          currentMode === 'listen' && desktopStore.desktopState.isWindowShown
        "
        class="quick-mode-layer"
      >
        <ListenView
          :key="activationId"
          @result-shown="listenResultShown = $event"
        />
      </div>
      <!-- Hiding preserves the view until its next activation. A new activation
           remounts action menus to clear their previous query and language. -->
      <div v-show="currentMode === 'selectionActions'" class="quick-mode-layer">
        <SelectionView
          v-if="currentMode === 'selectionActions'"
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
      <div v-show="currentMode === 'translation'" class="quick-mode-layer">
        <TranslateView
          v-if="currentMode === 'translation'"
          :key="activationId"
        />
      </div>
      <div v-show="currentMode === 'styling'" class="quick-mode-layer">
        <StylingView v-if="currentMode === 'styling'" :key="activationId" />
      </div>
      <div v-show="currentMode === 'transformation'" class="quick-mode-layer">
        <TransformationView
          v-if="currentMode === 'transformation'"
          :key="activationId"
        />
      </div>
      <div v-show="quickAiRequestVariant" class="quick-mode-layer">
        <QuickAiRequestView
          v-if="quickAiRequestVariant"
          :key="activationId"
          :input-mode="quickAiRequestVariant.inputMode"
          :screenshot-mode="quickAiRequestVariant.isScreenshot"
        />
      </div>
      <div v-show="currentMode === 'chatPrompts'" class="quick-mode-layer">
        <ChatPromptsView
          v-if="currentMode === 'chatPrompts'"
          :key="activationId"
        />
      </div>
      <div v-show="currentMode === 'favorites'" class="quick-mode-layer">
        <FavoritesView v-if="currentMode === 'favorites'" :key="activationId" />
      </div>
      <div v-show="currentMode === 'customAction'" class="quick-mode-layer">
        <CustomActionView
          v-if="currentMode === 'customAction'"
          :key="activationId"
        />
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
import { desktopClient } from '../../lib/desktop/client'
import { getDesktopWindow as getCurrentWindow } from '../../lib/desktop/window'
import { resultOrThrow } from '../../lib/ipc/ipc-model'
import { clientLogger } from '../../lib/logger'
import { quickAiRequestVariantOf } from '../../lib/quick-ai-request/quick-ai-request-variant'
import { createFocusLossWatcher } from '../../lib/quick-panel/focus-loss'
import {
  type InputRegion,
  createInputRegionSync,
  inputRegion,
  unionRect,
} from '../../lib/quick-panel/input-region'
import { createWindowFocus } from '../../lib/quick-panel/window-focus'
import { useDesktopStore } from '../../stores/desktop'
import { useIpcStore } from '../../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickInputStore } from '../../stores/quick-input'
import ChatPromptsView from '../../views/ChatPromptsView.vue'
import CorrectionView from '../../views/CorrectionView.vue'
import CustomActionView from '../../views/CustomActionView.vue'
import ExternalAccessView from '../../views/ExternalAccessView.vue'
import FavoritesView from '../../views/FavoritesView.vue'
import ListenView from '../../views/ListenView.vue'
import QuickAiRequestView from '../../views/QuickAiRequestView.vue'
import SelectionView from '../../views/SelectionView.vue'
import StylingView from '../../views/StylingView.vue'
import TransformationView from '../../views/TransformationView.vue'
import TranslateView from '../../views/TranslateView.vue'
import VoiceCommandsView from '../../views/VoiceCommandsView.vue'
import VoiceView from '../../views/VoiceView.vue'
import WriteView from '../../views/WriteView.vue'
import ScreenshotSelector from '../screenshot/ScreenshotSelector.vue'
import OverlayDragHandle from './OverlayDragHandle.vue'
import {
  type CropRect,
  DESKTOP_EVENTS,
  type ScreenshotAreaSelection,
} from '@tyco/shared'

const ipcStore = useIpcStore()
const desktopStore = useDesktopStore()
const menuModalsStore = useMenuModalsStore()
const quickInputStore = useQuickInputStore()
const cardRef = ref<HTMLElement | null>(null)
const { t } = useI18n()

const currentMode = computed(
  () => desktopStore.desktopState?.mode || 'quickInput'
)
const quickAiRequestVariant = computed(() =>
  quickAiRequestVariantOf(currentMode.value)
)
const activationId = computed(() => desktopStore.desktopState.activationId)
const hasModal = computed(
  () => menuModalsStore.currentModal !== MenuModals.NONE
)

/** The dictation is over: its result takes the whole window */
const voiceResultShown = ref(false)
/** The listening is over: its transcript or its outcome takes the window */
const listenResultShown = ref(false)

/** Modes shown as a panel at the bottom while nothing else is open */
const isPanelMode = computed(
  () =>
    currentMode.value === 'quickInput' ||
    (currentMode.value === 'voice' && !voiceResultShown.value) ||
    (currentMode.value === 'listen' && !listenResultShown.value) ||
    currentMode.value === 'customAction'
)

const activeAreaSelection = ref<ScreenshotAreaSelection | null>(null)
const isAwaitingCaptureOutcome = ref(false)
let stopSelectAreaListener: (() => void) | undefined
let stopSelectAreaClosedListener: (() => void) | undefined

const onConfirmCrop = async (crop: CropRect) => {
  const selection = activeAreaSelection.value
  if (!selection) return
  isAwaitingCaptureOutcome.value = true
  activeAreaSelection.value = null
  await ipcStore.call('confirm_screenshot_crop', {
    selectionId: selection.selectionId,
    crop,
  })
}

const onCancelCrop = async () => {
  const selection = activeAreaSelection.value
  if (!selection) return
  isAwaitingCaptureOutcome.value = true
  activeAreaSelection.value = null
  await ipcStore.call('cancel_screenshot_crop', {
    selectionId: selection.selectionId,
  })
}

/** Without the image there is nothing to select on: tell why it ended */
const onSelectorFailed = async () => {
  await onCancelCrop()
  void ipcStore.call('show_status_overlay', {
    request: {
      kind: 'error',
      text: t('screenshot.imageLoadFailed'),
      hideAfterMs: 6000,
    },
  })
}

const isSheet = computed(() => {
  return (
    Boolean(activeAreaSelection.value) ||
    !isPanelMode.value ||
    menuModalsStore.currentModal !== MenuModals.NONE ||
    Boolean(menuModalsStore.pendingModal)
  )
})

/** What stays clickable while only the input or the voice bar is shown. */
const INPUT_PARTS = '.write-live-preview, .write-frame, .write-hint, .voice-bar'

// The window keeps one size; while it shows only the input, the rest of it
// lets clicks through to the windows below
const regionSync = createInputRegionSync({
  apply: async (region) => {
    resultOrThrow(await ipcStore.call('set_quick_input_region', { region }))
  },
})

// a new activation owns its own operations, results and input region
const session = useQuickWindowSession({
  onActivation: () => regionSync.invalidate(),
})
const keepsOnFocusLoss = computed(session.keepsOnFocusLoss)

let pendingRevealFrame: number | undefined

const cancelPendingReveal = () => {
  if (
    pendingRevealFrame !== undefined &&
    typeof cancelAnimationFrame === 'function'
  ) {
    cancelAnimationFrame(pendingRevealFrame)
    pendingRevealFrame = undefined
  }
}

const scheduleQuickWindowReveal = () => {
  cancelPendingReveal()
  if (!desktopStore.desktopState.isWindowShown) return
  void nextTick(() => {
    if (unmounted || !desktopStore.desktopState.isWindowShown) return
    const reveal = () => {
      pendingRevealFrame = undefined
      if (unmounted || !desktopStore.desktopState.isWindowShown) return
      void ipcStore.call('reveal_quick_window')
    }
    if (typeof requestAnimationFrame === 'function') {
      pendingRevealFrame = requestAnimationFrame(reveal)
    } else {
      reveal()
    }
  })
}

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
  canDismiss: () =>
    !activeAreaSelection.value && session.canDismissOnFocusLoss(),
  onLost: session.dismissOnBlur,
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
    !activeAreaSelection.value &&
    !isWindowFocused.value &&
    isSheet.value &&
    Boolean(desktopStore.desktopState.isWindowShown)
)
let unmounted = false

const measureInputRegion = (): InputRegion | null => {
  if (
    activeAreaSelection.value ||
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
  void regionSync
    .update(measureInputRegion())
    .catch((error: unknown) =>
      clientLogger.error('Could not update the input region', error, 'quick')
    )
}

const updateInputRegionAfterRender = () => {
  void nextTick(updateInputRegion)
}

let inputResizeObserver: ResizeObserver | undefined
let inputMutationObserver: MutationObserver | undefined

function observeInputParts() {
  inputResizeObserver?.disconnect()
  cardRef.value
    ?.querySelectorAll(INPUT_PARTS)
    .forEach((element) => inputResizeObserver?.observe(element))
}

const syncFocus = () => {
  if (currentMode.value === 'quickInput') {
    quickInputStore.requestFocus()
  }
}

onMounted(() => {
  syncFocus()
  scheduleQuickWindowReveal()
  inputResizeObserver = new ResizeObserver(updateInputRegion)
  observeInputParts()
  if (cardRef.value && typeof MutationObserver !== 'undefined') {
    inputMutationObserver = new MutationObserver(() => {
      observeInputParts()
      updateInputRegion()
    })
    inputMutationObserver.observe(cardRef.value, {
      childList: true,
      subtree: true,
    })
  }
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
    .catch((error: unknown) =>
      clientLogger.error('Could not watch window focus', error, 'quick')
    )
  void desktopClient
    .listen(DESKTOP_EVENTS.SCREENSHOT_SELECT_AREA_CLOSED, () => {
      activeAreaSelection.value = null
      isAwaitingCaptureOutcome.value = false
    })
    .then((remove) => {
      if (unmounted) remove()
      else stopSelectAreaClosedListener = remove
    })
    .catch((error: unknown) =>
      clientLogger.error(
        'Could not watch screenshot area select',
        error,
        'quick'
      )
    )
  void desktopClient
    .listen(DESKTOP_EVENTS.SCREENSHOT_SELECT_AREA, (payload) => {
      isAwaitingCaptureOutcome.value = false
      activeAreaSelection.value = payload
    })
    .then((remove) => {
      if (unmounted) remove()
      else stopSelectAreaListener = remove
    })
    .catch((error: unknown) =>
      clientLogger.error(
        'Could not watch screenshot area select',
        error,
        'quick'
      )
    )
})

onUnmounted(() => {
  unmounted = true
  cancelPendingReveal()
  inputResizeObserver?.disconnect()
  inputMutationObserver?.disconnect()
  window.removeEventListener('resize', updateInputRegion)
  regionSync.dispose()
  focusLoss.dispose()
  windowFocus.dispose()
  removeFocusListener?.()
  stopSelectAreaListener?.()
  stopSelectAreaClosedListener?.()
  delete document.documentElement.dataset.windowFocused
})

watch([currentMode, () => desktopStore.desktopState.isWindowShown], () => {
  void nextTick(observeInputParts)
})

watch(
  [
    isSheet,
    activeAreaSelection,
    // the input and the voice bar are both panels, of different sizes
    currentMode,
    () => desktopStore.desktopState.isWindowShown,
    () => desktopStore.desktopState.activationId,
  ],
  updateInputRegionAfterRender
)

watch(
  [
    () => desktopStore.desktopState.activationId,
    () => desktopStore.desktopState.isWindowShown,
  ],
  () => {
    activeAreaSelection.value = null
    isAwaitingCaptureOutcome.value = false
  }
)

// Keep focus in the input field when window is shown or hidden so focus arrives immediately
watch(
  () => desktopStore.desktopState.isWindowShown,
  (isShown) => {
    syncFocus()
    if (isShown) void windowFocus.refresh()
    else cancelPendingReveal()
  }
)

watch(
  [
    () => desktopStore.desktopState.isWindowShown,
    () => desktopStore.desktopState.activationId,
    currentMode,
  ],
  ([isShown]) => {
    if (isShown) scheduleQuickWindowReveal()
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
  padding: var(--space-xs);
  box-sizing: border-box;
}

.quick-overlay-root.is-panel {
  justify-content: flex-end;
}

.quick-overlay-root.is-selecting-area {
  padding: 0;
}

.quick-overlay-root.is-sheet {
  justify-content: center;
  align-items: center;
}

.quick-sheet-drag-handle {
  position: absolute;
  top: var(--space-2xs, 0.125rem);
  left: 50%;
  z-index: 2;
  transform: translateX(-50%);
}

.quick-overlay-card {
  position: relative;
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
:global([data-window-focused='false'] .write-live-preview),
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

.quick-overlay-root.has-modal .quick-overlay-card,
.quick-overlay-root.is-hidden .quick-overlay-card {
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
