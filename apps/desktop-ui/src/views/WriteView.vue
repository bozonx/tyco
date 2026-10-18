<template>
  <div ref="containerRef" class="write-mode-container">
    <div ref="frameRef" class="write-frame">
      <WriteModeInput class="flex-1" :max-height="inputMaxHeight" />
    </div>
    <!-- mousedown.prevent keeps the focus and the caret in the input -->
    <p ref="hintRef" class="write-hint">
      <button
        type="button"
        class="write-hint-action"
        @mousedown.prevent
        @click="submitFromHint"
      >
        <KeyboardKey>{{ submitShortcutLabel }}</KeyboardKey>
        <span>{{ t('write.correctAndInsert') }}</span>
      </button>
      <span class="text-faint">•</span>
      <button
        type="button"
        class="write-hint-action"
        @mousedown.prevent
        @click="nextFromHint"
      >
        <KeyboardKey>Tab</KeyboardKey>
        <span>{{ t('write.next') }}</span>
      </button>
      <span class="text-faint">•</span>
      <button
        type="button"
        class="write-hint-action"
        @mousedown.prevent
        @click="insertNewline"
      >
        <KeyboardKey>{{ newlineShortcutLabel }}</KeyboardKey>
        <span>{{ t('write.newLine') }}</span>
      </button>
      <span class="text-faint">•</span>
      <button
        type="button"
        class="write-hint-action"
        @mousedown.prevent
        @click="cancelFromHint"
      >
        <KeyboardKey>Esc</KeyboardKey>
        <span>{{ t('write.cancel') }}</span>
      </button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import KeyboardKey from '../components/common/KeyboardKey.vue'
import WriteModeInput from '../components/quick/WriteModeInput.vue'
import { useI18n } from '../composables/use-i18n'
import {
  newlineShortcut,
  resolveInputKeyAction,
  resolveSubmitKey,
  submitShortcut,
} from '../lib/input-keys/input-keys'
import { maxInputHeight } from '../lib/quick-panel/input-height'
import { useCorrectionWorkflowStore } from '../stores/correction-workflow'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { useQuickInputStore } from '../stores/quick-input'

const navPanelStore = useNavPanelStore()
const quickInputStore = useQuickInputStore()
const ipcStore = useIpcStore()
const desktopStore = useDesktopStore()
const menuModalsStore = useMenuModalsStore()
const correctionWorkflowStore = useCorrectionWorkflowStore()
const { t } = useI18n()
const submitKey = computed(() =>
  resolveSubmitKey(desktopStore.userConfig?.editor?.submitKey)
)
const prefetch = computed(
  () =>
    desktopStore.userConfig?.quickWindow?.isCorrectionPrefetchEnabled === true
)
const submitShortcutLabel = computed(() => submitShortcut(submitKey.value))
const newlineShortcutLabel = computed(() => newlineShortcut(submitKey.value))

const containerRef = ref<HTMLElement | null>(null)
const frameRef = ref<HTMLElement | null>(null)
const hintRef = ref<HTMLElement | null>(null)
// the input grows up to the top of the window, then scrolls
const inputMaxHeight = ref(200)

const px = (value: string) => Number.parseFloat(value) || 0

function measureInputMaxHeight() {
  const container = containerRef.value
  const frame = frameRef.value
  const hint = hintRef.value
  if (!container || !frame || !hint || container.clientHeight === 0) return
  const frameStyle = getComputedStyle(frame)
  inputMaxHeight.value = maxInputHeight({
    containerHeight: container.clientHeight,
    siblingsHeight: hint.offsetHeight,
    gapsHeight: px(getComputedStyle(container).rowGap),
    frameChromeHeight:
      px(frameStyle.borderTopWidth) +
      px(frameStyle.borderBottomWidth) +
      px(frameStyle.paddingTop) +
      px(frameStyle.paddingBottom),
  })
}

let layoutObserver: ResizeObserver | undefined

const canCorrect = (text: string) => text.trim().length > 0

function resetNav() {
  navPanelStore.resetNavPanelState({ panelVisible: false })
}

resetNav()

watch(
  () => desktopStore.desktopState?.activationId,
  () => {
    correctionWorkflowStore.cancelInsert()
    const { isWindowShown, mode } = desktopStore.desktopState
    if (isWindowShown && mode === 'write') {
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      resetNav()
      // a kept text comes back selected: typing replaces it
      if (quickInputStore.startSession())
        quickInputStore.requestFocusAndSelectAll()
      else quickInputStore.requestFocus()
    }
  },
  { immediate: true }
)

watch(
  () => quickInputStore.value,
  (text) => {
    if (menuModalsStore.pendingModal) correctionWorkflowStore.cancelInsert()
    correctionWorkflowStore.schedulePrecorrection(
      prefetch.value && canCorrect(text) ? text : null
    )
  }
)

watch(
  () => desktopStore.desktopState?.isWindowShown,
  (isShown) => {
    if (!isShown) {
      correctionWorkflowStore.cancelInsert()
      correctionWorkflowStore.cancelPrecorrection()
    }
  }
)

function cancelAndClose() {
  correctionWorkflowStore.cancelInsert()
  correctionWorkflowStore.cancelPrecorrection()
  // Esc drops the text from the history; ArrowUp still brings it back
  quickInputStore.discard()
  menuModalsStore.cancelPending()
  menuModalsStore.closeAll()
  resetNav()
  void ipcStore.callFunctionOrNotify('hideWindow')
}

/** Whether the input takes commands: not while a modal is over it. */
const acceptsInput = () =>
  desktopStore.desktopState.isWindowShown &&
  desktopStore.desktopState.mode === 'write' &&
  !menuModalsStore.hasOpenModal

function submitFromHint() {
  if (!acceptsInput() || menuModalsStore.pendingModal) return
  submit()
}

function nextFromHint() {
  if (!acceptsInput() || menuModalsStore.pendingModal) return
  const text = quickInputStore.value
  if (!text.trim()) return
  quickInputStore.rememberSubmitted(text)
  menuModalsStore.nextModal(MenuModals.INSERT, { text })
}

function cancelFromHint() {
  if (!acceptsInput()) return
  cancelAndClose()
}

/** Inserts a line break at the caret, as the newline shortcut does. */
async function insertNewline() {
  if (!acceptsInput() || menuModalsStore.pendingModal) return
  const textarea = frameRef.value?.querySelector('textarea')
  const text = quickInputStore.value
  const start = textarea?.selectionStart ?? text.length
  const end = textarea?.selectionEnd ?? text.length
  quickInputStore.setValue(`${text.slice(0, start)}\n${text.slice(end)}`)
  await nextTick()
  textarea?.focus()
  textarea?.setSelectionRange(start + 1, start + 1)
}

function handleKeyDown(event: KeyboardEvent) {
  if (!acceptsInput()) return

  const action = resolveInputKeyAction(event, submitKey.value)

  // Cancellation drops the text and closes the window, including while
  // waiting for correction.
  if (action === 'cancel') {
    event.preventDefault()
    cancelAndClose()
    return
  }

  if (menuModalsStore.pendingModal) {
    if (action !== 'none') event.preventDefault()
    return
  }

  if (action !== 'none') {
    event.preventDefault()
    if (event.repeat) return
    if (action === 'actions') nextFromHint()
    else if (action === 'newline') void insertNewline()
    else submit()
    return
  }
  // the unused Enter variant neither sends nor breaks the line
  if (event.code === 'Enter' && !event.isComposing) event.preventDefault()

  if (
    event.code === 'ArrowUp' &&
    !quickInputStore.value &&
    quickInputStore.recallText
  ) {
    event.preventDefault()
    quickInputStore.setValue(quickInputStore.recallText)
  }
}

onMounted(() => {
  window.addEventListener('keydown', handleKeyDown)
  layoutObserver = new ResizeObserver(measureInputMaxHeight)
  if (containerRef.value) layoutObserver.observe(containerRef.value)
  if (hintRef.value) layoutObserver.observe(hintRef.value)
  measureInputMaxHeight()
})

onUnmounted(() => {
  window.removeEventListener('keydown', handleKeyDown)
  layoutObserver?.disconnect()
  correctionWorkflowStore.cancelInsert()
  correctionWorkflowStore.cancelPrecorrection()
})

function submit() {
  const text = quickInputStore.value
  quickInputStore.rememberSubmitted(text)
  void correctionWorkflowStore.insert(text)
}
</script>

<style scoped>
.write-mode-container {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  gap: var(--space-sm);
  width: 100%;
  height: 100%;
}

.write-frame {
  display: flex;
  align-items: center;
  min-height: 2.25rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-quick-surface);
  backdrop-filter: var(--app-quick-backdrop);
  box-shadow: var(--app-shadow-md);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
  flex-shrink: 0;
}

.write-frame:focus-within {
  border-color: var(--color-primary);
  box-shadow: var(--app-shadow-sm), var(--app-focus-ring);
}

/* The window is transparent: the plate keeps the hint readable over whatever
   lies below it */
.write-hint {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  align-self: flex-start;
  gap: var(--space-sm);
  margin: 0;
  padding: 0.25rem 0.625rem 0.25rem 0.25rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: var(--app-quick-hint-surface);
  backdrop-filter: var(--app-quick-backdrop);
  box-shadow: var(--app-shadow-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  flex-shrink: 0;
}

.write-hint-action {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.125rem 0.375rem 0.125rem 0.125rem;
  border-radius: var(--radius-md);
  color: inherit;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    color var(--transition-fast);
}

.write-hint-action:hover {
  background-color: var(--app-hover);
  color: var(--color-base-content);
}
</style>
