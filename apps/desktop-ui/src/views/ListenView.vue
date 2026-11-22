<template>
  <div v-if="isBar" class="listen-layer">
    <ListenRecordingBar
      :model="model"
      :audio-level="audioLevel"
      :audio-peak="audioPeak"
      :recording-duration-ms="recordingDurationMs"
      :stop-hotkey="stopHotkey"
      :app-label="appLabel"
      :has-back="hasBack"
      @back="handleBack"
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
import { clientLogger } from '../lib/logger'
import { describeDictationError } from '../lib/stt/dictation-error'
import { createKeyPressTracker } from '../lib/ui/key-press-tracker'
import { isTextEntryTarget } from '../lib/ui/text-entry-target'
import { stoppedRecordingActions } from '../lib/voice/stopped-recording-actions'
import { useActionMenuStore } from '../stores/action-menu'
import { useCloseWindowStore } from '../stores/close-window'
import { useDesktopStore } from '../stores/desktop'
import { useDictationHandoffStore } from '../stores/dictation-handoff'
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useVoiceReferenceStore } from '../stores/voice-reference'
import { useVoiceResultStore } from '../stores/voice-result'

const emit = defineEmits<{
  /** The recording is over and its outcome takes the whole window */
  (e: 'result-shown', shown: boolean): void
}>()

const { toastKey } = useToast()
const actionMenuStore = useActionMenuStore()
const desktopStore = useDesktopStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const closeWindowStore = useCloseWindowStore()
const modeSwitch = useQuickModeSwitch()
const { startDictation, finishDictation, cancelDictation, switchSource } =
  useDictationActions()
// a click into the player must not end the listening, nor its result
const releaseDismissHold = useQuickDismissStore().hold()
const voiceReferenceStore = useVoiceReferenceStore()
const origin = computed(() =>
  voiceReferenceStore.originFor(desktopStore.desktopState.activationId)
)
const hasBack = computed(() => Boolean(origin.value))

async function handleBack() {
  const previous = origin.value
  await model.cancel()
  if (previous?.mode === 'selectionActions') {
    await ipcStore.callOrNotify('activate_mode', {
      mode: 'selectionActions',
      text: previous.text ?? undefined,
    })
  } else {
    closeWindowStore.closeAll()
  }
}

const handoff = useDictationHandoffStore()
const model = createListenModel({
  initialText: handoff.take('listen', desktopStore.desktopState.activationId),
  // the computer sound has a language of its own, see `listenLanguage`
  startDictation: (handlers) =>
    startDictation({
      ...handlers,
      language: desktopStore.userConfig.stt?.listenLanguage ?? 'auto',
    }),
  finishDictation,
  cancelDictation,
  switchSource,
  createHistorySession: () =>
    historyStore.createInputSession(
      () => toastKey('history.operationFailed', 'error'),
      'listen'
    ),
  onAutoStop: (reason) => {
    toastKey(
      reason === 'silence'
        ? 'toast.recordingSilenceStop'
        : 'toast.recordingLimitReached',
      'warn'
    )
    if (hasBack.value) {
      void handleBack()
    } else {
      void model.close()
    }
    return 'handled'
  },
  describeError: (error) => describeDictationError(error, translate),
  logError: (message, error) =>
    clientLogger.warn(`${message}: ${String(error)}`, 'stt'),
  onClose: () => closeWindowStore.closeAll(),
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
watch(
  () => model.phase.value,
  (phase) => {
    if (phase === 'result') {
      actionMenuStore.openPage(0)
    }
  }
)

const appLabel = computed(() =>
  model.source.value.kind === 'application' &&
  model.source.value.appId === desktopStore.userConfig.stt?.listenAppId?.trim()
    ? desktopStore.userConfig.stt?.listenAppLabel
    : undefined
)
const configuredSource = () =>
  configuredListenSource(desktopStore.userConfig.stt)

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
  dismiss: () => {
    if (hasBack.value) {
      void handleBack()
    } else {
      void model.close()
    }
  },
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
    // Shift+Space too: the result of a listening is its actions menu
    (!event.shiftKey || event.code === 'Space') &&
    !isInteractiveOrTypingTarget(event.target)
  ) {
    if (event.code === 'Space') event.preventDefault()
    void model.stop()
    return
  }
  // the key that ended the recording runs the primary action of the stop:
  // records again, or opens the settings that a retry cannot fix
  if (
    isBar.value &&
    (event.code === 'Enter' || event.code === 'Space') &&
    !event.defaultPrevented &&
    !event.shiftKey &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !isInteractiveOrTypingTarget(event.target) &&
    (model.phase.value === 'empty' || model.phase.value === 'failed')
  ) {
    const { primary } = stoppedRecordingActions({
      canRetry: model.canRetry.value,
      canOpenSettings: model.canOpenSettings.value,
    })
    if (!primary) return
    event.preventDefault()
    if (primary === 'retry') void model.retry()
    else openSttSettings()
  }
}

const forgetKeys = () => keyPresses.clear()

/** Starts voice input with a fresh recording session. */
async function switchToVoice() {
  if (isChangingMode.value || model.phase.value === 'finishing') return
  isChangingMode.value = true
  await model.cancel()
  useVoiceResultStore().step.resetResult()
  const switched = await modeSwitch.switchTo('voice')
  if (!switched.success) {
    isChangingMode.value = false
    await model.start(configuredSource())
  }
}

function handleLanguageChange() {
  // the transcript so far stays: the new language applies from now on
  if (model.phase.value === 'recording') {
    void model.restartKeepingText()
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
