<template>
  <RecordingBarFrame
    v-if="startError"
    class="voice-stopped-bar"
    :class="{ 'is-error': !startError.isEmpty }"
    :label="t('menu.voiceInput')"
  >
    <div class="voice-stopped-header">
      <OverlayDragHandle />
      <QuickModeSwitch
        v-if="props.canSwitchMode"
        mode="voice"
        :disabled="!desktopStore.desktopState.canListen"
        @switch="switchToListen"
      />
      <ShortcutButton
        class="voice-stopped-close"
        size="sm"
        :keys="['Esc']"
        @click="dismissStartError"
      >
        {{ t('common.close') }}
      </ShortcutButton>
    </div>
    <RecordingStoppedNotice
      :kind="startError.isEmpty ? 'empty' : 'error'"
      :message="startError.message"
      :hint="startError.hint"
      source="microphone"
    />
    <div class="voice-stopped-actions">
      <ShortcutButton
        v-if="
          props.finishBehavior !== 'prompt' &&
          liveTranscriptText(transcript).trim()
        "
        size="sm"
        :keys="['Shift', 'Space']"
        @click="preserveErrorDraft('next')"
        >{{ t('menu.actions') }}</ShortcutButton
      >
      <Button
        v-if="props.allowEmptyInput"
        size="sm"
        :variant="startError.canRetry ? 'ghost' : 'primary'"
        @click="openEmptyInput"
        >{{ t('menu.typeText') }}</Button
      >
      <Button
        v-if="startError.canOpenSettings"
        size="sm"
        :variant="startError.canRetry ? 'ghost' : 'primary'"
        icon="mdi:cog-outline"
        @click="openSttSettings"
      >
        {{ t('common.openSettings') }}
      </Button>
      <ShortcutButton
        v-if="startError.canRetry"
        size="sm"
        variant="primary"
        :keys="['Space']"
        @click="retryAfterError"
      >
        {{ t('listen.retry') }}
      </ShortcutButton>
    </div>
  </RecordingBarFrame>
  <component
    v-else
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
    :cancel-shortcut="props.cancelShortcut"
    :show-cancel-button="props.showCancelButton"
    :prefix="props.prefix"
    :suffix="props.suffix"
    :context="props.context"
    :styling-presets="activeStylingPresets"
    :finish="finish"
    :finish-with-style="finishWithStyle"
    :cancel="cancel"
    :reply-to="props.replyTo"
    :reference-text="props.referenceText"
    :can-switch-mode="props.canSwitchMode"
    :microphone-id="sessionMicrophoneId"
    :select-microphone="selectMicrophone"
    @remove-context="emit('removeContext')"
    @switch-mode="switchToListen"
    @language-change="handleLanguageChange"
  />
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

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
import {
  isRetryableDictationError,
  isSettingsFixableDictationError,
} from '../../lib/stt/dictation-error'
import { resolveDictationTarget } from '../../lib/stt/dictation-target'
import { liveTranscriptText } from '../../lib/stt/live-transcript'
import type { VoiceFinishIntent } from '../../lib/stt/voice-finish-intent'
import { createVoiceRecognition } from '../../lib/stt/voice-recognition'
import { stylingSlotList } from '../../lib/styling/styling-library'
import { createKeyPressTracker } from '../../lib/ui/key-press-tracker'
import { isTextEntryTarget } from '../../lib/ui/text-entry-target'
import { useDesktopStore } from '../../stores/desktop'
import { useDictationHandoffStore } from '../../stores/dictation-handoff'
import { useHistoryStore } from '../../stores/history'
import { useIpcStore } from '../../stores/ipc'
import { useLlmStore } from '../../stores/llm'
import { useMenuModalsStore } from '../../stores/menu-modals'
import { useQuickDismissStore } from '../../stores/quick-dismiss'
import Button from '../common/Button.vue'
import ShortcutButton from '../overlay/ShortcutButton.vue'
import OverlayDragHandle from '../quick/OverlayDragHandle.vue'
import QuickModeSwitch from '../voice/QuickModeSwitch.vue'
import RecordingBarFrame from '../voice/RecordingBarFrame.vue'
import RecordingStoppedNotice from '../voice/RecordingStoppedNotice.vue'
import VoiceRecordingBar from '../voice/VoiceRecordingBar.vue'
import VoiceRecordingSheet from '../voice/VoiceRecordingSheet.vue'
import { SHORTCUT_SLOT_KEYS } from '@tyco/shared'

const props = withDefaults(
  defineProps<
    VoiceMenuParams & {
      /** The listened message this dictation replies to */
      referenceText?: string
      replyTo?: string
      /** The quick window may switch to listening from here */
      canSwitchMode?: boolean
      /** Keep a start failure visible inline instead of hiding the quick bar */
      keepErrorVisible?: boolean
      showCancelButton?: boolean
      allowEmptyInput?: boolean
    }
  >(),
  { showCancelButton: true }
)
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
const ipcStore = useIpcStore()
const startError = ref<{
  message: string
  canOpenSettings: boolean
  isEmpty?: boolean
  /** A likely cause of the empty result */
  hint?: string
  canRetry: boolean
} | null>(null)

function openSttSettings() {
  void ipcStore.callOrNotify('activate_mode', {
    mode: 'config',
    settingsTab: 'stt',
  })
  if (startError.value) {
    startError.value = null
    emit('cancelled')
  }
}

async function preserveErrorDraft(intent: VoiceFinishIntent) {
  const text = liveTranscriptText(transcript.value)
  await model.cancelWithoutClosing()
  startError.value = null
  emit('corrected', text, text, undefined, intent)
}

async function openEmptyInput() {
  await model.cancelWithoutClosing()
  startError.value = null
  emit('corrected', '', '', undefined, 'insert')
}

function dismissStartError() {
  startError.value = null
  emit('cancelled')
}

function retryAfterError() {
  startError.value = null
  void startSession()
}
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
const sessionMicrophoneId = ref(desktopStore.userConfig.stt.microphoneId ?? '')
const handoff = useDictationHandoffStore()
let microphoneTranscript =
  props.activationMode === 'voice'
    ? handoff.take('voice', desktopStore.desktopState.activationId)
    : ''
let isSwitchingSource = false
let switchedText: string | undefined
async function selectMicrophone(id: string) {
  microphoneTranscript = liveTranscriptText(transcript.value)
  sessionMicrophoneId.value = id
  await model.restartSession()
  if (!liveTranscriptText(transcript.value).trim())
    transcript.value = { committed: microphoneTranscript, draft: '' }
}
const model = createVoiceRecognition({
  startDictation: (handlers) =>
    startDictation({
      ...handlers,
      microphoneId: sessionMicrophoneId.value,
      onText: (state) =>
        handlers.onText({
          ...state,
          committed: [microphoneTranscript, state.committed]
            .filter(Boolean)
            .join(' '),
        }),
    }),
  finishDictation: async () =>
    [microphoneTranscript, await finishDictation()].filter(Boolean).join(' '),
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
  onEmptyInput: () => {
    startError.value = {
      message: t('listen.nothingRecognized'),
      hint: t(
        maxAudioPeak < QUIET_MICROPHONE_PEAK
          ? 'listen.quietMicrophoneHint'
          : 'listen.nothingRecognizedHint'
      ),
      isEmpty: true,
      canOpenSettings: false,
      canRetry: true,
    }
  },
  onCancelled: () => {
    if (isSwitchingSource) return
    startError.value = null
    if (!ownsActivation()) return
    invokeCallback(props.onCancel)
    emit('cancelled')
  },
  onStartError: (error, message) => {
    const canOpenSettings = isSettingsFixableDictationError(error)
    if (props.keepErrorVisible) {
      startError.value = {
        message,
        canOpenSettings,
        canRetry: !canOpenSettings || isRetryableDictationError(error),
      }
      return 'keep'
    }
    if (canOpenSettings) {
      toastText(message, 'error', {
        durationMs: 10_000,
        action: { label: t('common.openSettings'), run: openSttSettings },
      })
      return 'handled'
    }
    return undefined
  },
  // the text is delivered even if the window was hidden while it was being
  // transcribed or corrected: it cannot be dictated the same way twice
  onCorrected: (result, recognized, corrected, intent) => {
    if (isSwitchingSource) {
      switchedText = result
      return
    }
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
/** Starts system audio with a fresh recording session. */
async function switchToListen() {
  if (isSwitchingSource || isFinishing.value) return
  const activationId = desktopStore.desktopState.activationId
  const draft = liveTranscriptText(transcript.value).trim()
  isSwitchingSource = true
  switchedText = undefined
  try {
    await model.finish('edit')
    if (desktopStore.desktopState.activationId !== activationId) return
    const text = switchedText ?? draft
    handoff.set(text, 'listen', modeSwitch.nextActivationId())
    startError.value = null
    const result = await modeSwitch.switchTo('listen')
    if (!result.success) {
      handoff.clear()
      if (text) emit('corrected', text, text, undefined, 'next')
      else await startSession()
    }
  } finally {
    isSwitchingSource = false
  }
}

function handleLanguageChange() {
  if (startError.value) {
    retryAfterError()
    return
  }
  if (!liveTranscriptText(transcript.value).trim() && !isFinishing.value) {
    void model.restartSession()
    return
  }
  toastKey('stt.languageSavedForNext', 'info')
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
    if (startError.value) {
      dismissStartError()
      return
    }
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
/**
 * Below this sample peak (about -34 dBFS) the microphone hardly heard anything:
 * an empty result then points at the microphone, not the speech
 */
const QUIET_MICROPHONE_PEAK = 0.02
let maxAudioPeak = 0
watch(audioPeak, (peak) => {
  maxAudioPeak = Math.max(maxAudioPeak, peak)
})
watch(isStarted, (started) => {
  if (started) maxAudioPeak = 0
})

useDismissibleLayer({
  isOpen: ownsActivation,
  elements: () => [],
  canDismissOutside: false,
  dismiss: () => {
    if (startError.value) {
      dismissStartError()
      return
    }
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

  if (startError.value) {
    const hasDraft = Boolean(liveTranscriptText(transcript.value).trim())
    if (
      event.code === 'Space' &&
      event.shiftKey &&
      hasDraft &&
      props.finishBehavior !== 'prompt'
    )
      void preserveErrorDraft('next')
    else if (
      (event.code === 'Enter' || event.code === 'Space') &&
      !event.shiftKey
    ) {
      // the key that started the recording records again
      if (startError.value.canRetry) retryAfterError()
      else if (props.allowEmptyInput) void preserveErrorDraft('insert')
    }
    return
  }

  const matchingStyle = findMatchingStyle(event)
  if (matchingStyle) {
    event.preventDefault()
    void finishWithStyle(matchingStyle.rule)
    return
  }

  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
    return

  if (event.shiftKey && event.code === 'Space') {
    if (props.finishBehavior === 'insertIntoTarget') {
      event.preventDefault()
      void finish('next')
      return
    }
    const intent =
      props.finishBehavior === 'submitToChat'
        ? 'insert'
        : props.chat
          ? 'submit'
          : undefined
    if (
      intent &&
      (props.finishBehavior !== 'prompt' ||
        liveTranscriptText(transcript.value).trim())
    ) {
      event.preventDefault()
      void finish(intent)
    }
    return
  }
  if (!event.shiftKey && (event.code === 'Space' || event.code === 'Enter')) {
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

  if (event.ctrlKey || event.metaKey || event.altKey || event.isComposing)
    return

  // Prevent default scroll when Space or Shift+Space is pressed
  if (
    event.code === 'Space' ||
    (props.finishBehavior === 'submitToChat' &&
      event.shiftKey &&
      event.code === 'Space')
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
    sessionMicrophoneId.value = desktopStore.userConfig.stt.microphoneId ?? ''
    microphoneTranscript = ''
    startError.value = null
    void startSession()
  }
)

watch(isOwnWindowShown, (isShown) => {
  if (!isShown) {
    void model.cancelWithoutClosing()
    startError.value = null
    void model
      .flushHistory()
      .catch(() => toastKey('history.operationFailed', 'error'))
    return
  }
  sessionActivationId = desktopStore.desktopState.activationId
  sessionMicrophoneId.value = desktopStore.userConfig.stt.microphoneId ?? ''
  microphoneTranscript = ''
  startError.value = null
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
    if (microphoneTranscript && !liveTranscriptText(transcript.value).trim())
      transcript.value = { committed: microphoneTranscript, draft: '' }
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

<style scoped>
.voice-stopped-bar.is-error {
  border-color: color-mix(in oklab, var(--color-error) 55%, transparent);
}

.voice-stopped-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.voice-stopped-close {
  margin-left: auto;
  width: auto;
}

.voice-stopped-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: flex-end;
  gap: var(--space-xs);
  padding-top: var(--space-xs);
  border-top: 1px solid var(--app-border-subtle);
  --shortcut-flex: 0 0 auto;
  --shortcut-width: auto;
}
</style>
