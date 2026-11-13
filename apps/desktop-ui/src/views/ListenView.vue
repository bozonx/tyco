<template>
  <div v-if="isBar" class="listen-layer">
    <ListenRecordingBar
      :model="model"
      :audio-level="audioLevel"
      :audio-peak="audioPeak"
      :recording-duration-ms="recordingDurationMs"
      :stop-hotkey="stopHotkey"
      :app-label="appLabel"
      @switch-mode="switchToVoice"
      @language-change="handleLanguageChange"
      @open-settings="openSttSettings"
    />
  </div>
  <ContentPadding v-else>
    <div class="listen-result">
      <p
        v-if="model.errorText.value && model.phase.value === 'result'"
        role="alert"
      >
        {{ model.errorText.value }}
      </p>
      <InsertMenu
        v-if="model.phase.value === 'result'"
        :text="model.resultText.value"
        :allow-insert-button="true"
        :allow-remove-context="false"
        :shortcuts-disabled="menuModalsStore.hasOpenModal"
      />
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref, watch } from 'vue'

import ContentPadding from '../components/common/ContentPadding.vue'
import ListenRecordingBar from '../components/listen/ListenRecordingBar.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import { useDictationActions } from '../composables/use-dictation-actions'
import { useDismissibleLayer } from '../composables/use-dismissible-layer'
import { useQuickModeSwitch } from '../composables/use-quick-mode-switch'
import useToast from '../composables/use-toast'
import { useVoiceFinishSignal } from '../composables/use-voice-finish-signal'
import { useVoiceRecordingMeter } from '../composables/use-voice-recording-meter'
import { translate } from '../lib/i18n'
import {
  configuredListenSource,
  createListenModel,
} from '../lib/listen/listen-model'
import { describeDictationError } from '../lib/stt/dictation-error'
import { liveTranscriptText } from '../lib/stt/live-transcript'
import { createKeyPressTracker } from '../lib/ui/key-press-tracker'
import { isTextEntryTarget } from '../lib/ui/text-entry-target'
import { useDesktopStore } from '../stores/desktop'
import { useDictationHandoffStore } from '../stores/dictation-handoff'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useVoiceResultStore } from '../stores/voice-result'
import { useWindowStore } from '../stores/window'

const emit = defineEmits<{
  /** The recording is over and its outcome takes the whole window */
  (e: 'result-shown', shown: boolean): void
}>()

const { toastKey } = useToast()
const desktopStore = useDesktopStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const windowStore = useWindowStore()
const modeSwitch = useQuickModeSwitch()
const { startDictation, finishDictation, cancelDictation, switchSource } =
  useDictationActions()
// a click into the player must not end the listening, nor its result
const releaseDismissHold = useQuickDismissStore().hold()

const handoff = useDictationHandoffStore()
const model = createListenModel({
  initialText: handoff.take('listen', desktopStore.desktopState.activationId),
  startDictation,
  finishDictation,
  cancelDictation,
  switchSource,
  saveTranscript: async (text) => {
    const session = historyStore.createInputSession(
      () => toastKey('history.operationFailed', 'error'),
      'listen'
    )
    session.update(text)
    await session.flush()
  },
  onAutoStop: (reason) =>
    toastKey(
      reason === 'silence'
        ? 'toast.recordingSilenceStop'
        : 'toast.recordingLimitReached',
      'warn'
    ),
  describeError: (error) => describeDictationError(error, translate),
  onClose: () => {
    menuModalsStore.cancelAndCloseAll()
    void windowStore.hide()
  },
})

const isChangingMode = ref(false)
const isBar = computed(
  () =>
    isChangingMode.value ||
    model.phase.value === 'recording' ||
    model.phase.value !== 'result'
)
watch(
  () =>
    desktopStore.desktopState.isWindowShown &&
    desktopStore.desktopState.mode === 'listen',
  (active) => {
    if (!active) void model.cancel()
  },
  { flush: 'sync' }
)
watch(isBar, (bar) => emit('result-shown', !bar), { immediate: true })

const appLabel = computed(() =>
  model.source.value.kind === 'application' &&
  model.source.value.appId === desktopStore.userConfig.stt?.listenAppId?.trim()
    ? desktopStore.userConfig.stt?.listenAppLabel
    : undefined
)
const configuredSource = () =>
  configuredListenSource(desktopStore.userConfig.stt?.listenAppId)

const stopHotkey = useVoiceFinishSignal(
  () => 'listen',
  () => void model.repeatHotkey()
)
const { audioLevel, audioPeak, recordingDurationMs } = useVoiceRecordingMeter(
  () => model.isRecording.value
)

useDismissibleLayer({
  isOpen: () =>
    desktopStore.desktopState.isWindowShown &&
    desktopStore.desktopState.mode === 'listen' &&
    !menuModalsStore.hasOpenModal,
  elements: () => [],
  canDismissOutside: false,
  dismiss: () => void model.close(),
})

const keyPresses = createKeyPressTracker()
const isInteractiveOrTypingTarget = (target: EventTarget | null) =>
  isTextEntryTarget(target) ||
  (target instanceof Element &&
    Boolean(target.closest('button, [role="menu"], [role="menuitem"], a')))

function onKeyDown(event: KeyboardEvent) {
  if (
    event.isComposing ||
    event.keyCode === 229 ||
    isInteractiveOrTypingTarget(event.target)
  ) {
    return
  }
  if (event.code === 'Space' && model.isRecording.value) event.preventDefault()
  keyPresses.press(event.code)
}

function onKeyUp(event: KeyboardEvent) {
  if (!keyPresses.release(event.code)) return
  if (
    (event.code === 'Enter' || event.code === 'Space') &&
    model.isRecording.value &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    (!event.shiftKey || event.code === 'Space') &&
    !isInteractiveOrTypingTarget(event.target)
  ) {
    if (event.code === 'Space') event.preventDefault()
    void model.stop()
    return
  }
  // the key that ended the recording records again after an empty one
  if (
    isBar.value &&
    (event.code === 'Enter' || event.code === 'Space') &&
    !event.defaultPrevented &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !isInteractiveOrTypingTarget(event.target) &&
    (model.phase.value === 'empty' ||
      (model.phase.value === 'failed' && model.canRetry.value))
  ) {
    event.preventDefault()
    void model.retry()
  }
}

const forgetKeys = () => keyPresses.clear()

/** Starts voice input with a fresh recording session. */
async function switchToVoice() {
  if (isChangingMode.value || model.phase.value === 'finishing') return
  isChangingMode.value = true
  const activationId = desktopStore.desktopState.activationId
  const draft = liveTranscriptText(model.transcript.value).trim()
  await model.stop()
  if (desktopStore.desktopState.activationId !== activationId) return
  const text = model.resultText.value || draft
  useVoiceResultStore().step.resetResult()
  handoff.set(text, 'voice', modeSwitch.nextActivationId())
  const switched = await modeSwitch.switchTo('voice')
  if (!switched.success) {
    handoff.clear()
    isChangingMode.value = false
    if (!text) await model.start(configuredSource())
  }
}

function handleLanguageChange() {
  if (
    model.phase.value === 'recording' &&
    !liveTranscriptText(model.transcript.value).trim()
  ) {
    void model.restartWithCurrentSource()
    return
  }
  if (model.phase.value === 'failed') {
    void model.restartWithCurrentSource()
    return
  }
  toastKey('stt.languageSavedForNext', 'info')
}

function openSttSettings() {
  void ipcStore.callOrNotify('activate_mode', {
    mode: 'config',
    settingsTab: 'stt',
  })
}

onMounted(() => {
  document.addEventListener('keydown', onKeyDown, true)
  document.addEventListener('keyup', onKeyUp)
  window.addEventListener('blur', forgetKeys)
  void model.start(configuredSource())
})

onUnmounted(() => {
  document.removeEventListener('keydown', onKeyDown, true)
  document.removeEventListener('keyup', onKeyUp)
  window.removeEventListener('blur', forgetKeys)
  releaseDismissHold()
  model.dispose()
})
</script>

<style scoped>
.listen-layer {
  display: flex;
  flex-direction: column;
  justify-content: flex-end;
  width: 100%;
  height: 100%;
}

.listen-result {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  height: 100%;
  min-height: 0;
}
</style>
