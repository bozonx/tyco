<template>
  <component
    :is="props.variant === 'bar' ? VoiceRecordingBar : VoiceRecordingSheet"
    :transcript="transcript"
    :audio-level="audioLevel"
    :audio-peak="audioPeak"
    :recording-duration-ms="recordingDurationMs"
    :auto-stop-deadline-ms="autoStopWarning?.deadlineMs"
    :is-transcribing="isTranscribing"
    :is-correcting="isCorrecting"
    :is-styling="isStyling"
    :is-finishing="isFinishing"
    :finish-behavior="props.finishBehavior"
    :finish-hotkey="finishHotkey"
    :chat="props.chat"
    :prefix="props.prefix"
    :suffix="props.suffix"
    :context="props.context"
    :styling-presets="activeStylingPresets"
    :finish="finish"
    :finish-with-style="finishWithStyle"
    :cancel="cancel"
    :reply-to="props.replyTo"
    :can-switch-mode="props.canSwitchMode"
    @remove-context="emit('removeContext')"
    @switch-mode="switchToListen"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'

import { useCopyText } from '../../composables/use-copy-text'
import { useDictationActions } from '../../composables/use-dictation-actions'
import { useDismissibleLayer } from '../../composables/use-dismissible-layer'
import { useI18n } from '../../composables/use-i18n'
import { useQuickModeSwitch } from '../../composables/use-quick-mode-switch'
import useToast from '../../composables/use-toast'
import { useVoiceFinishSignal } from '../../composables/use-voice-finish-signal'
import { useVoiceRecordingMeter } from '../../composables/use-voice-recording-meter'
import { hasSeparateQuickWindow, isQuickWindow } from '../../lib/desktop/window'
import { describeError } from '../../lib/errors/describe-error'
import { isEditorHistoryOff } from '../../lib/history/editor-history-storage'
import type { VoiceMenuParams } from '../../lib/modals/menu-modal-params'
import { isModeOfWindow } from '../../lib/navigation/routes'
import { resolveDictationTarget } from '../../lib/stt/dictation-target'
import { liveTranscriptText } from '../../lib/stt/live-transcript'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import { createVoiceRecognition } from '../../lib/stt/voice-recognition'
import { stylingSlotList } from '../../lib/styling/styling-library'
import { createKeyPressTracker } from '../../lib/ui/key-press-tracker'
import { isTextEntryTarget } from '../../lib/ui/text-entry-target'
import { useDesktopStore } from '../../stores/desktop'
import { useHistoryStore } from '../../stores/history'
import { useLlmStore } from '../../stores/llm'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickDismissStore } from '../../stores/quick-dismiss'
import VoiceRecordingBar from '../voice/VoiceRecordingBar.vue'
import VoiceRecordingSheet from '../voice/VoiceRecordingSheet.vue'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const props = defineProps<
  VoiceMenuParams & {
    /** The listened message this dictation replies to */
    replyTo?: string
    /** The quick window may switch to listening from here */
    canSwitchMode?: boolean
  }
>()
const emit = defineEmits<{
  (
    e: 'corrected',
    resultText: string,
    recognizedText: string,
    correctedText: string | undefined,
    intent: VoiceFinishIntent
  ): void
  (e: 'cancelled'): void
  (e: 'removeContext'): void
}>()

const {
  cancelDictation,
  finishDictation,
  shouldFormatRecognizedText,
  shouldCorrectContextually,
  startDictation,
} = useDictationActions()
const { voiceCorrection, contextualVoiceCorrection, stylingPrompt } =
  useLlmStore().actions
const { toastKey, toastText } = useToast()
const { t } = useI18n()
const desktopStore = useDesktopStore()
let sessionActivationId = desktopStore.desktopState.activationId
const isSameActivation = () =>
  sessionActivationId === desktopStore.desktopState.activationId
/**
 * The desktop state is shared by the windows: an activation of the other window
 * shows that one and hides this one, while `isWindowShown` stays true
 */
const isOwnWindowShown = () =>
  desktopStore.desktopState.isWindowShown &&
  (!hasSeparateQuickWindow() ||
    isModeOfWindow(desktopStore.desktopState.mode, isQuickWindow()))
const ownsActivation = () => isSameActivation() && isOwnWindowShown()
const historyStore = useHistoryStore()
const menuModalsStore = useMenuModalsStore()
// a click elsewhere must not cut a dictation short
const releaseDismissHold = useQuickDismissStore().hold()

function invokeCallback<Args extends unknown[]>(
  callback: ((...args: Args) => void) | ((...args: Args) => void)[] | undefined,
  ...args: Args
) {
  if (typeof callback === 'function') callback(...args)
  else if (Array.isArray(callback)) callback.forEach((fn) => fn(...args))
}
const copyText = useCopyText({ saveOutput: true })
/** How long the user has to take a dictation the window moved on from */
const ORPHANED_RESULT_TOAST_MS = 30_000

/**
 * A dictation nobody cancelled, whose screen has moved on (another activation,
 * another mode): it cannot be dictated the same way twice, so it is offered for
 * copying instead of dropped. Only the toast holds it, and only for a while: no
 * other store of the input is added, and with the history turned off nothing is
 * kept once the toast is gone
 */
function offerOrphanedResult(text: string) {
  const isInHistory = !isEditorHistoryOff(desktopStore.userConfig)
  toastText(
    isInHistory
      ? `${t('toast.dictationResultReady')}\n${t('toast.dictationResultInHistory')}`
      : t('toast.dictationResultReady'),
    'info',
    {
      durationMs: ORPHANED_RESULT_TOAST_MS,
      action: { label: t('action.copy'), run: () => void copyText(text) },
    }
  )
}
const dictationTarget = computed(() => resolveDictationTarget(props))
const model = createVoiceRecognition({
  startDictation,
  finishDictation,
  cancelDictation,
  shouldFormatRecognizedText: () =>
    shouldFormatRecognizedText(dictationTarget.value),
  shouldInsertStyleDirectly: () =>
    desktopStore.userConfig.stt?.isStylingBarDirectInsertEnabled ?? false,
  // a voice reply is corrected with the message it answers
  voiceCorrection: (text, signal) =>
    voiceCorrection(text, signal, props.replyTo),
  shouldCorrectContextually,
  contextualVoiceCorrection: (text, signal) =>
    contextualVoiceCorrection(text, signal, props.replyTo),
  voiceStyling: (text, rule, signal) => stylingPrompt(rule, text, { signal }),
  createHistorySession: () =>
    historyStore.createInputSession(
      () => toastKey('history.operationFailed', 'error'),
      'voice'
    ),
  saveSource: (text, action) => historyStore.saveSource(text, action, 'voice'),
  saveSourceResult: (id, text) => historyStore.saveSourceResult(id, text),
  saveSourceFailure: (id, failure) =>
    historyStore.saveSourceFailure(id, failure),
  describeError: (error) => describeError(error, t),
  setPendingModal: (options) => menuModalsStore.setPendingModal(options),
  clearPendingModal: (owner) => menuModalsStore.clearPendingModal(owner),
  consumeBufferedIntent: () => menuModalsStore.consumeBufferedIntent(),
  options: () => props,
  onCancelled: () => {
    if (!ownsActivation()) return
    invokeCallback(props.onCancel)
    emit('cancelled')
  },
  // the text is delivered even if the window was hidden while it was being
  // transcribed or corrected: it cannot be dictated the same way twice
  onCorrected: (result, recognized, corrected, intent) => {
    if (isSameActivation())
      emit('corrected', result, recognized, corrected, intent)
    // inserting into a window the user has left would hit the wrong target
    else offerOrphanedResult(result)
  },
  onAbandoned: offerOrphanedResult,
  t,
  toastKey,
  toastText,
})
const {
  transcript,
  autoStopWarning,
  isFinishing,
  isStarted,
  isTranscribing,
  isCorrecting,
  isStyling,
  cancel,
  finish,
  finishWithStyle,
  startSession,
} = model
const modeSwitch = useQuickModeSwitch()
/** Leaves for listening; words already dictated are kept as a result first */
async function switchToListen() {
  if (liveTranscriptText(transcript.value).trim()) {
    await finish('next')
    return
  }
  await modeSwitch.switchTo('listen')
}
const isVoiceActivation = computed(() => props.activationMode === 'voice')
const isStylingBarEnabled = computed(
  () => desktopStore.userConfig.stt?.isStylingBarEnabled ?? false
)
const stylingPresets = computed(() =>
  stylingSlotList(desktopStore.userConfig.styling)
)
const hasStylingBar = computed(
  () =>
    props.variant === 'bar' &&
    isVoiceActivation.value &&
    isStylingBarEnabled.value
)
const activeStylingPresets = computed(() =>
  hasStylingBar.value ? stylingPresets.value : undefined
)
/** What Space and Enter do: send the question to the chat, or insert the text */
const primaryIntent = (): VoiceFinishIntent =>
  props.finishBehavior === 'submitToChat' ? 'submit' : 'insert'
const finishHotkey = useVoiceFinishSignal(
  () => props.activationMode,
  () => {
    if (ownsActivation()) void finish(primaryIntent())
  },
  // Push-to-Talk: letting go ends the recording this hold started
  () => {
    if (ownsActivation() && (isStarted.value || model.isStarting()))
      void finish(primaryIntent())
  }
)
const { audioLevel, audioPeak, recordingDurationMs } = useVoiceRecordingMeter(
  () => isStarted.value
)

useDismissibleLayer({
  isOpen: ownsActivation,
  elements: () => [],
  canDismissOutside: false,
  dismiss: () => {
    void cancel()
  },
})

// Enter on the button that opened this input, or a hotkey with Space, ends
// with a keyup here that must not finish the dictation it just started
const keyPresses = createKeyPressTracker()
/**
 * The inline bar shares the screen with the editor or the chat input: keys
 * typed there, and Enter that confirms an IME composition, are the text's
 */
const isTypingKey = (event: KeyboardEvent) =>
  event.isComposing || event.keyCode === 229 || isTextEntryTarget(event.target)
const trackKeyDown = (event: KeyboardEvent) => {
  if (!isTypingKey(event)) keyPresses.press(event.code)
}
const forgetKeys = () => keyPresses.clear()

function findMatchingStyle(event: KeyboardEvent) {
  if (!hasStylingBar.value || event.ctrlKey || event.altKey || event.metaKey) {
    return undefined
  }
  let codeLetter: string | undefined
  if (event.code.length === 4 && event.code.startsWith('Key')) {
    codeLetter = event.code.slice(3).toLowerCase()
  }
  const eventKey = event.key.toLowerCase()
  const index = SHORTCUT_SLOT_KEYS.findIndex(
    (slotKey) => slotKey === eventKey || slotKey === codeLetter
  )
  if (index === -1) return undefined
  const item = stylingPresets.value[index]
  return item && item.rule.trim() ? item : undefined
}

function handleKeyUp(event: KeyboardEvent) {
  if (!keyPresses.release(event.code)) return
  if (isTypingKey(event)) return
  if (event.defaultPrevented) return

  const matchingStyle = findMatchingStyle(event)
  if (matchingStyle) {
    event.preventDefault()
    void finishWithStyle(matchingStyle.rule)
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.code === 'Enter') {
    event.preventDefault()
    void finish('submit')
    return
  }

  // as in a chat input, Shift+Enter or Shift+Space keeps the text without sending it
  if (
    props.finishBehavior === 'submitToChat' &&
    event.shiftKey &&
    (event.code === 'Enter' || event.code === 'Space')
  ) {
    event.preventDefault()
    void finish('insert')
    return
  }

  if (
    (props.finishBehavior === 'submitToChat' ||
      props.finishBehavior === 'insertIntoTarget') &&
    event.code === 'Tab' &&
    !event.shiftKey
  ) {
    event.preventDefault()
    void finish('next')
    return
  }

  if (event.code === 'Space' || event.code === 'Enter') {
    void finish(primaryIntent())
  }
}

function handleKeyDown(event: KeyboardEvent) {
  if (isTypingKey(event)) return
  const matchingStyle = findMatchingStyle(event)
  if (matchingStyle) {
    event.preventDefault()
    return
  }

  if ((event.ctrlKey || event.metaKey) && event.code === 'Enter') {
    event.preventDefault()
    void finish('submit')
    return
  }

  // Tab finishes the dictation; it must not move the focus first
  if (
    (props.finishBehavior === 'submitToChat' ||
      props.finishBehavior === 'insertIntoTarget') &&
    event.code === 'Tab' &&
    !event.shiftKey
  ) {
    event.preventDefault()
  }

  // Prevent default scroll when Space or Shift+Space is pressed
  if (
    event.code === 'Space' ||
    (props.finishBehavior === 'submitToChat' &&
      event.shiftKey &&
      (event.code === 'Enter' || event.code === 'Space'))
  ) {
    event.preventDefault()
  }
}

// A hidden window still owns its recording. Reopening it adopts the new
// activation without restarting the microphone or discarding recognized words.
watch(
  () => desktopStore.desktopState.activationId,
  (activationId) => {
    if (!isOwnWindowShown() || isFinishing.value) return
    if (
      props.activationMode &&
      desktopStore.desktopState.mode !== props.activationMode
    )
      return
    sessionActivationId = activationId
    void startSession()
  }
)

watch(isOwnWindowShown, (isShown) => {
  if (!isShown) {
    void model
      .flushHistory()
      .catch(() => toastKey('history.operationFailed', 'error'))
    return
  }
  sessionActivationId = desktopStore.desktopState.activationId
  void startSession()
})

onMounted(async () => {
  // on the document, so it runs before the nav panel's Esc handler on the window
  document.addEventListener('keyup', handleKeyUp)
  // capture: a handler that stops the keydown must not hide it from tracking
  document.addEventListener('keydown', trackKeyDown, true)
  window.addEventListener('keydown', handleKeyDown)
  window.addEventListener('blur', forgetKeys)

  if (
    desktopStore.desktopState?.isWindowShown === undefined ||
    isOwnWindowShown()
  ) {
    await startSession()
  }
})

onUnmounted(() => {
  releaseDismissHold()
  model.dispose()

  document.removeEventListener('keyup', handleKeyUp)
  document.removeEventListener('keydown', trackKeyDown, true)
  window.removeEventListener('keydown', handleKeyDown)
  window.removeEventListener('blur', forgetKeys)
})
</script>
