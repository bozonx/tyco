<template>
  <div ref="containerRef" class="write-mode-container">
    <div ref="frameRef" class="write-frame">
      <WriteModeInput class="flex-1" :max-height="inputMaxHeight" />
    </div>
    <p ref="hintRef" class="write-hint">
      <KeyButton>{{ submitShortcutLabel }}</KeyButton>
      <span>{{ t('write.next') }}</span>
      <span class="opacity-40">•</span>
      <KeyButton>{{ newlineShortcutLabel }}</KeyButton>
      <span>{{ t('write.newLine') }}</span>
      <span class="opacity-40">•</span>
      <KeyButton>Esc</KeyButton>
      <span>{{ t('write.cancel') }}</span>
    </p>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import { useCallAi } from '../composables/useCallAi'
import { useI18n } from '../composables/useI18n'
import useToast from '../composables/useToast'
import { translate } from '../lib/i18n'
import { LlmError } from '../lib/llm/llm-client'
import { formatLlmError } from '../lib/llm/llm-errors'
import {
  createQuickCorrection,
  isCorrectionAborted,
} from '../lib/quick-input/quick-correction'
import { resolveQuickInputKeyAction } from '../lib/quick-input/quick-input-keys'
import { maxInputHeight } from '../lib/quick-panel/input-height'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menuModals'
import { useNavPanelStore } from '../stores/navPanel'
import { useWriterInputStore } from '../stores/writerInput'

const navPanelStore = useNavPanelStore()
const writerInputStore = useWriterInputStore()
const ipcStore = useIpcStore()
const { correctText } = useCallAi()
const menuModalsStore = useMenuModalsStore()
const historyStore = useHistoryStore()
const { toast, toastText } = useToast()
const appConfig = ipcStore.params!.appConfig
const { t } = useI18n()

const submitMode = computed(
  () => ipcStore.params?.userConfig?.quickInputSubmit || 'enter'
)
const correctionMode = computed(
  () => ipcStore.params?.userConfig?.quickCorrection || 'background'
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

const quickCorrection = createQuickCorrection({
  // errors are shown by the step that needed the result
  correct: (text, signal) => correctText(text, { signal, notifyError: false }),
})

/** Bumped by every submit and cancel: late results of older ones are dropped */
let submitId = 0

const needsCorrection = (text: string) =>
  correctionMode.value !== 'manual' &&
  text.trim().length > 0 &&
  text.length >= appConfig.minCorrectionLength

function resetNav() {
  navPanelStore.resetNavParams({ panelVisible: false })
}

resetNav()

watch(
  () => ipcStore.params?.activationId,
  () => {
    const { isWindowShown, mode } = ipcStore.params
    if (isWindowShown && mode === 'write') {
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

// correct in advance while the user pauses, so the submit rarely waits
watch(
  () => writerInputStore.value,
  (text) => {
    quickCorrection.speculate(needsCorrection(text) ? text : null)
  }
)

watch(
  () => ipcStore.params?.isWindowShown,
  (isShown) => {
    if (!isShown) cancelCorrection()
  }
)

function cancelCorrection() {
  submitId += 1
  quickCorrection.cancel()
}

function cancelAndClose() {
  cancelCorrection()
  writerInputStore.clear()
  menuModalsStore.closeAll()
  resetNav()
  void ipcStore.callFunction('closeWindow', [])
}

function handleKeyDown(event: KeyboardEvent) {
  if (
    !ipcStore.params.isWindowShown ||
    ipcStore.params.mode !== 'write' ||
    menuModalsStore.anyModalOpen
  ) {
    return
  }

  const action = resolveQuickInputKeyAction(event, submitMode.value)

  // while waiting for the correction, Esc returns to the text
  if (menuModalsStore.pendingModal) {
    if (action !== 'none') event.preventDefault()
    if (action === 'cancel') menuModalsStore.cancelPending()
    return
  }

  if (action === 'cancel') {
    event.preventDefault()
    cancelAndClose()
    return
  }

  if (action === 'submit') {
    event.preventDefault()
    void submit()
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
  quickCorrection.cancel()
})

function describeError(error: unknown): string {
  if (error instanceof LlmError) return formatLlmError(error, translate)
  return error instanceof Error ? error.message : String(error)
}

async function saveCorrection(text: string, result: string) {
  try {
    const sourceId = await historyStore.saveSource(text, 'correction')
    await historyStore.saveSourceResult(sourceId, result)
  } catch {
    toast(t('history.operationFailed'), 'error')
  }
}

/** Params of the insert step showing the correction of `text`. */
function correctedParams(text: string, result: string) {
  return result === text
    ? { text, oldText: '', originalText: undefined }
    : { text: result, oldText: text, originalText: text }
}

async function submit() {
  const text = writerInputStore.value
  const id = ++submitId
  writerInputStore.rememberSubmitted(text)

  if (!needsCorrection(text)) {
    menuModalsStore.nextModal(MenuModals.INSERT, { text, oldText: '' })
    return
  }

  const ready = quickCorrection.peek(text)
  if (ready !== undefined) {
    void saveCorrection(text, ready)
    menuModalsStore.nextModal(MenuModals.INSERT, correctedParams(text, ready))
    return
  }

  const background = correctionMode.value === 'background'
  if (background) {
    menuModalsStore.nextModal(MenuModals.INSERT, {
      text,
      oldText: '',
      correcting: true,
      onCancelCorrection: () => {
        cancelCorrection()
        menuModalsStore.updateModalParams(MenuModals.INSERT, {
          correcting: false,
          onCancelCorrection: undefined,
        })
      },
    })
  } else {
    menuModalsStore.setPendingModal({
      correction: true,
      onCancel: cancelCorrection,
    })
  }

  try {
    const result = await quickCorrection.request(text)
    if (id !== submitId) return
    void saveCorrection(text, result)
    if (background) {
      menuModalsStore.updateModalParams(MenuModals.INSERT, {
        ...correctedParams(text, result),
        correcting: false,
        onCancelCorrection: undefined,
      })
    } else {
      menuModalsStore.nextModal(
        MenuModals.INSERT,
        correctedParams(text, result)
      )
    }
  } catch (error) {
    if (isCorrectionAborted(error) || id !== submitId) return
    const message = describeError(error)
    toastText(message, 'error')
    // the text can still be inserted as it was typed
    if (background) {
      menuModalsStore.updateModalParams(MenuModals.INSERT, {
        correcting: false,
        correctionError: message,
        onCancelCorrection: undefined,
      })
    } else {
      menuModalsStore.nextModal(MenuModals.INSERT, {
        text,
        oldText: '',
        correctionError: message,
      })
    }
  }
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
</style>
