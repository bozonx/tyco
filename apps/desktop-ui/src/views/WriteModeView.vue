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
        <KeyButton>{{ submitShortcutLabel }}</KeyButton>
        <span>{{ autoCorrect ? t('write.correct') : t('write.next') }}</span>
      </button>
      <span class="opacity-40">•</span>
      <button
        type="button"
        class="write-hint-action"
        @mousedown.prevent
        @click="submitAltFromHint"
      >
        <KeyButton>Alt+Enter</KeyButton>
        <span>{{
          autoCorrect ? t('write.nextWithoutCorrection') : t('write.correct')
        }}</span>
      </button>
      <span class="opacity-40">•</span>
      <button
        type="button"
        class="write-hint-action"
        @mousedown.prevent
        @click="insertNewline"
      >
        <KeyButton>{{ newlineShortcutLabel }}</KeyButton>
        <span>{{ t('write.newLine') }}</span>
      </button>
      <span class="opacity-40">•</span>
      <button
        type="button"
        class="write-hint-action"
        @mousedown.prevent
        @click="cancelFromHint"
      >
        <KeyButton>Esc</KeyButton>
        <span>{{ t('write.cancel') }}</span>
      </button>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import { useI18n } from '../composables/useI18n'
import { resolveQuickInputKeyAction } from '../lib/quick-input/quick-input-keys'
import { maxInputHeight } from '../lib/quick-panel/input-height'
import { useCorrectionStore } from '../stores/correction'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { useWriterInputStore } from '../stores/writerInput'

const navPanelStore = useNavPanelStore()
const writerInputStore = useWriterInputStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const correctionStore = useCorrectionStore()
const appConfig = ipcStore.params!.appConfig
const { t } = useI18n()

const submitMode = computed(
  () => ipcStore.params?.userConfig?.quickInputSubmit || 'enter'
)
/** The submit key corrects the text; Alt+Enter then goes without it */
const autoCorrect = computed(
  () => ipcStore.params?.userConfig?.quickCorrection === 'auto'
)
/** Correct in advance while the user pauses, so the correction rarely waits */
const prefetch = computed(
  () =>
    autoCorrect.value ||
    ipcStore.params?.userConfig?.quickCorrectionPrefetch === true
)
const submitShortcutLabel = computed(() =>
  submitMode.value === 'ctrlEnter' ? 'Ctrl+Enter' : 'Enter'
)
const newlineShortcutLabel = computed(() =>
  submitMode.value === 'ctrlEnter' ? 'Enter' : 'Shift+Enter'
)

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

const canCorrect = (text: string) =>
  text.trim().length > 0 && text.length >= appConfig.minCorrectionLength

function resetNav() {
  navPanelStore.resetNavParams({ panelVisible: false })
}

resetNav()

watch(
  () => ipcStore.params?.activationId,
  () => {
    const { isWindowShown, mode } = ipcStore.params
    if (isWindowShown && mode === 'write') {
      // the step after the input was left open, not closed with Esc: its text
      // comes back like after a focus loss
      if (menuModalsStore.anyModalOpen || menuModalsStore.pendingModal) {
        writerInputStore.markDismissed()
      }
      menuModalsStore.cancelPending()
      menuModalsStore.closeAll()
      resetNav()
      if (writerInputStore.startSession()) {
        writerInputStore.focusAndSelectAll()
      } else {
        writerInputStore.focus()
      }
    }
  },
  { immediate: true }
)

watch(
  () => writerInputStore.value,
  (text) => {
    correctionStore.speculate(prefetch.value && canCorrect(text) ? text : null)
  }
)

watch(
  () => ipcStore.params?.isWindowShown,
  (isShown) => {
    if (!isShown) correctionStore.cancelSpeculation()
  }
)

function cancelAndClose() {
  correctionStore.cancelSpeculation()
  // Esc drops the text completely: it does not go to the history
  writerInputStore.discard()
  menuModalsStore.cancelPending()
  menuModalsStore.closeAll()
  resetNav()
  void ipcStore.callFunction('closeWindow', [])
}

/** Whether the input takes commands: not while a modal is over it. */
const acceptsInput = () =>
  ipcStore.params.isWindowShown &&
  ipcStore.params.mode === 'write' &&
  !menuModalsStore.anyModalOpen

function submitFromHint() {
  if (!acceptsInput() || menuModalsStore.pendingModal) return
  submit(autoCorrect.value)
}

function submitAltFromHint() {
  if (!acceptsInput() || menuModalsStore.pendingModal) return
  submit(!autoCorrect.value)
}

function cancelFromHint() {
  if (!acceptsInput()) return
  cancelAndClose()
}

/** Inserts a line break at the caret, as the newline shortcut does. */
async function insertNewline() {
  if (!acceptsInput() || menuModalsStore.pendingModal) return
  const textarea = frameRef.value?.querySelector('textarea')
  const text = writerInputStore.value
  const start = textarea?.selectionStart ?? text.length
  const end = textarea?.selectionEnd ?? text.length
  writerInputStore.setValue(`${text.slice(0, start)}\n${text.slice(end)}`)
  await nextTick()
  textarea?.focus()
  textarea?.setSelectionRange(start + 1, start + 1)
}

function handleKeyDown(event: KeyboardEvent) {
  if (!acceptsInput()) return

  const action = resolveQuickInputKeyAction(event, submitMode.value)

  // Esc always cancels: it drops the text and closes the window, also while
  // waiting for the correction. Do not make it return to the previous step
  if (action === 'cancel') {
    event.preventDefault()
    cancelAndClose()
    return
  }

  if (menuModalsStore.pendingModal) {
    if (action !== 'none') event.preventDefault()
    return
  }

  if (action === 'submit' || action === 'submitAlt') {
    event.preventDefault()
    submit(action === 'submit' ? autoCorrect.value : !autoCorrect.value)
    return
  }

  if (
    event.code === 'ArrowUp' &&
    !writerInputStore.value &&
    writerInputStore.lastSubmitted
  ) {
    event.preventDefault()
    writerInputStore.setValue(writerInputStore.lastSubmitted)
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
  correctionStore.cancelSpeculation()
})

/**
 * Opens the actions for the text as typed; with `correct`, its correction is
 * stacked over them, so going back returns to the text as typed
 */
function submit(correct: boolean) {
  const text = writerInputStore.value
  writerInputStore.rememberSubmitted(text)
  menuModalsStore.nextModal(MenuModals.INSERT, { text })
  if (correct && canCorrect(text)) void correctionStore.start(text)
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
  background-color: color-mix(in oklab, var(--app-surface) 96%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--app-shadow-md);
  transition:
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
  flex-shrink: 0;
}

.write-frame:focus-within {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  box-shadow:
    var(--app-shadow-sm),
    0 0 0 3px color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.write-frame :deep(.main-input) {
  min-height: 0 !important;
  height: auto;
  padding: 0.5rem 0.75rem;
  border: none;
  border-radius: 0;
  box-shadow: none;
  background: transparent;
  font-size: var(--editor-font-size);
  line-height: var(--editor-line-height);
  box-sizing: border-box;
}

/* The window is transparent: the plate keeps the hint readable over whatever
   lies below it */
.write-hint {
  display: flex;
  align-items: center;
  align-self: flex-start;
  gap: var(--space-sm);
  margin: 0;
  padding: 0.25rem 0.625rem 0.25rem 0.25rem;
  border: 1px solid var(--app-border);
  border-radius: var(--radius-lg);
  background-color: color-mix(in oklab, var(--app-surface) 92%, transparent);
  backdrop-filter: blur(16px);
  box-shadow: var(--app-shadow-sm);
  font-size: 0.75rem;
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
