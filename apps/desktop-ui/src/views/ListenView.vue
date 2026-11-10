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
    />
  </div>
  <ContentPadding v-else>
    <div class="listen-result">
      <div class="listen-result-header">
        <QuickModeSwitch mode="listen" @switch="switchToVoice" />
        <span class="listen-result-title">{{ t('listen.title') }}</span>
        <Button
          v-if="model.phase.value === 'result'"
          class="listen-reply"
          size="sm"
          variant="primary"
          icon="mdi:microphone-message"
          @click="replyByVoice"
        >
          {{ t('listen.replyByVoice') }}
        </Button>
      </div>
      <InsertMenu
        v-if="model.phase.value === 'result'"
        :text="model.resultText.value"
        :allow-insert-button="true"
        :shortcuts-disabled="menuModalsStore.hasOpenModal"
      />
      <div v-else class="listen-empty" role="status">
        <p>
          {{
            model.phase.value === 'failed'
              ? model.errorText.value
              : t('listen.nothingRecognized')
          }}
        </p>
        <div class="listen-empty-actions">
          <Button size="sm" @click="void model.close()">
            {{ t('common.close') }}
          </Button>
          <Button
            v-if="model.phase.value !== 'failed' || model.canRetry.value"
            size="sm"
            :variant="model.canOpenSettings.value ? 'ghost' : 'primary'"
            @click="void model.retry()"
          >
            {{ t('listen.retry') }}
          </Button>
          <Button
            v-if="model.phase.value === 'failed' && model.canOpenSettings.value"
            size="sm"
            variant="primary"
            icon="mdi:cog-outline"
            @click="openSttSettings"
          >
            {{ t('common.openSettings') }}
          </Button>
        </div>
      </div>
    </div>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'

import Button from '../components/common/Button.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import ListenRecordingBar from '../components/listen/ListenRecordingBar.vue'
import InsertMenu from '../components/menu/InsertMenu.vue'
import QuickModeSwitch from '../components/voice/QuickModeSwitch.vue'
import { useDictationActions } from '../composables/use-dictation-actions'
import { useDismissibleLayer } from '../composables/use-dismissible-layer'
import { useI18n } from '../composables/use-i18n'
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
import { useHistoryStore } from '../stores/history'
import { useIpcStore } from '../stores/ipc'
import { useListenReplyStore } from '../stores/listen-reply'
import { useMenuModalsStore } from '../stores/menu-modals'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useVoiceResultStore } from '../stores/voice-result'
import { useWindowStore } from '../stores/window'

const emit = defineEmits<{
  /** The recording is over and its outcome takes the whole window */
  (e: 'result-shown', shown: boolean): void
}>()

const { t } = useI18n()
const { toastKey } = useToast()
const desktopStore = useDesktopStore()
const historyStore = useHistoryStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const windowStore = useWindowStore()
const replyStore = useListenReplyStore()
const modeSwitch = useQuickModeSwitch()
const { startDictation, finishDictation, cancelDictation, switchSource } =
  useDictationActions()
// a click into the player must not end the listening, nor its result
const releaseDismissHold = useQuickDismissStore().hold()

const model = createListenModel({
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

const isBar = computed(
  () => model.phase.value === 'recording' || model.phase.value === 'finishing'
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
  keyPresses.press(event.code)
}

function onKeyUp(event: KeyboardEvent) {
  if (!keyPresses.release(event.code)) return
  if (
    event.code === 'Enter' &&
    model.isRecording.value &&
    !event.defaultPrevented &&
    !event.ctrlKey &&
    !event.altKey &&
    !event.metaKey &&
    !event.shiftKey &&
    !isInteractiveOrTypingTarget(event.target)
  ) {
    void model.stop()
  }
}

const forgetKeys = () => keyPresses.clear()

/** Leaves for voice input; what was heard is offered there, not lost */
async function switchToVoice() {
  if (model.phase.value === 'recording') {
    await model.stop()
    // a transcript stays shown here with the switch at hand
    if ((model.phase.value as string) === 'result') return
  }
  await model.cancel()
  useVoiceResultStore().step.resetResult()
  await modeSwitch.switchTo('voice')
}

/** Dictates an answer to what was heard: the transcript is its context */
async function replyByVoice() {
  replyStore.offer(model.resultText.value, modeSwitch.nextActivationId())
  await model.cancel()
  useVoiceResultStore().step.resetResult()
  await modeSwitch.switchTo('voice')
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
  void model.close()
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

.listen-result-header {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
}

.listen-result-title {
  font-weight: 600;
  color: var(--color-secondary);
}

.listen-reply {
  margin-left: auto;
}

.listen-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-md);
  flex: 1;
  text-align: center;
  color: var(--app-text-muted);
}

.listen-empty p {
  margin: 0;
  max-width: 32rem;
}

.listen-empty-actions {
  display: flex;
  gap: var(--space-sm);
}
</style>
