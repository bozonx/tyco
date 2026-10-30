<template>
  <div ref="containerRef" class="write-mode-container">
    <WriteLivePreview
      v-if="
        isLiveMode &&
        (textCorrectionStore.liveStatus === 'loading' ||
          textCorrectionStore.liveCorrectedText)
      "
      ref="livePreviewRef"
      :status="textCorrectionStore.liveStatus"
      :text="textCorrectionStore.liveCorrectedText"
      :original-text="quickInputStore.value"
      @accept="handleAcceptLiveCorrection"
    />
    <div ref="frameRef" class="write-frame">
      <WriteModeInput
        ref="inputRef"
        class="flex-1"
        :max-height="inputMaxHeight"
      />
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
        <span>{{
          isOffMode ? t('write.insert') : t('write.correctAndInsert')
        }}</span>
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
import WriteLivePreview from '../components/quick/WriteLivePreview.vue'
import WriteModeInput from '../components/quick/WriteModeInput.vue'
import { useDismissibleLayer } from '../composables/use-dismissible-layer'
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
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useNavPanelStore } from '../stores/nav-panel'
import { useQuickInputStore } from '../stores/quick-input'
import { useTextCorrectionStore } from '../stores/text-correction'
import { useWindowStore } from '../stores/window'

const navPanelStore = useNavPanelStore()
const quickInputStore = useQuickInputStore()
const windowStore = useWindowStore()
const desktopStore = useDesktopStore()
const menuModalsStore = useMenuModalsStore()
const correctionWorkflowStore = useCorrectionWorkflowStore()
const textCorrectionStore = useTextCorrectionStore()
const { t } = useI18n()
const submitKey = computed(() =>
  resolveSubmitKey(desktopStore.userConfig?.editor?.submitKey)
)
const correctionMode = computed(
  () => desktopStore.userConfig?.quickWindow?.correctionMode ?? 'onSubmit'
)
const isLiveMode = computed(() => correctionMode.value === 'live')
const isOffMode = computed(() => correctionMode.value === 'off')
const prefetch = computed(
  () =>
    desktopStore.userConfig?.quickWindow?.isCorrectionPrefetchEnabled === true
)
const submitShortcutLabel = computed(() => submitShortcut(submitKey.value))
const newlineShortcutLabel = computed(() => newlineShortcut(submitKey.value))

const containerRef = ref<HTMLElement | null>(null)
const inputRef = ref<InstanceType<typeof WriteModeInput> | null>(null)
const livePreviewRef = ref<InstanceType<typeof WriteLivePreview> | null>(null)
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
  const livePreviewEl =
    (livePreviewRef.value as unknown as { $el?: HTMLElement })?.$el ?? null
  const liveHeight = livePreviewEl?.offsetHeight ?? 0
  const gap = px(getComputedStyle(container).rowGap)
  inputMaxHeight.value = maxInputHeight({
    containerHeight: container.clientHeight,
    siblingsHeight: hint.offsetHeight + liveHeight,
    gapsHeight: gap * (livePreviewEl ? 2 : 1),
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

function handleAcceptLiveCorrection(corrected: string) {
  quickInputStore.setValue(corrected)
  inputRef.value?.focus()
}

watch(
  () => [textCorrectionStore.liveCorrectedText, textCorrectionStore.liveStatus],
  () => nextTick(measureInputMaxHeight)
)

watch(
  () => desktopStore.desktopState?.activationId,
  () => {
    correctionWorkflowStore.cancelInsert()
    textCorrectionStore.resetLive()
    const { isWindowShown, mode } = desktopStore.desktopState
    if (isWindowShown && mode === 'quickInput') {
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
    if (isLiveMode.value) {
      textCorrectionStore.handleLiveInput(text)
    } else if (correctionMode.value === 'onSubmit') {
      correctionWorkflowStore.schedulePrecorrection(
        prefetch.value && canCorrect(text) ? text : null
      )
    }
  }
)

watch(
  () => desktopStore.desktopState?.isWindowShown,
  (isShown) => {
    if (!isShown) {
      correctionWorkflowStore.cancelInsert()
      correctionWorkflowStore.cancelPrecorrection()
      textCorrectionStore.resetLive()
    }
  }
)

function cancelAndClose() {
  correctionWorkflowStore.cancelInsert()
  correctionWorkflowStore.cancelPrecorrection()
  textCorrectionStore.resetLive()
  // Esc drops the text from the history; ArrowUp still brings it back
  quickInputStore.discard()
  menuModalsStore.cancelPending()
  menuModalsStore.closeAll()
  resetNav()
  void windowStore.hide()
}

/** Whether the input takes commands: not while a modal is over it. */
const acceptsInput = () =>
  desktopStore.desktopState.isWindowShown &&
  desktopStore.desktopState.mode === 'quickInput' &&
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
  const input = inputRef.value
  const selection = input?.getSelection()
  const text = quickInputStore.value
  const start = selection?.start ?? text.length
  const end = selection?.end ?? text.length
  quickInputStore.setValue(`${text.slice(0, start)}\n${text.slice(end)}`)
  await nextTick()
  input?.focus()
  input?.select(start + 1, start + 1)
}

useDismissibleLayer({
  isOpen: acceptsInput,
  elements: () => [containerRef.value],
  canDismissOutside: false,
  keyboardPhase: 'bubble',
  dismiss: cancelAndClose,
})

function handleKeyDown(event: KeyboardEvent) {
  if (!acceptsInput() || event.defaultPrevented) return

  const action = resolveInputKeyAction(event, submitKey.value)
  if (action === 'cancel') return

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
  textCorrectionStore.resetLive()
})

function submit() {
  const text = quickInputStore.value
  if (!text.trim()) return
  quickInputStore.rememberSubmitted(text)
  if (isOffMode.value) {
    void correctionWorkflowStore.insertDirect(text)
  } else if (isLiveMode.value) {
    void correctionWorkflowStore.insertLive(text)
  } else {
    void correctionWorkflowStore.insert(text)
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
