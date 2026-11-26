<template>
  <ContentPadding>
    <ActionOverlayLayout
      :other-actions-text="contextText"
      :title="t('voiceCommands.windowTitle')"
      :esc-mode="voice.canStepBack ? 'back' : 'auto'"
      :on-esc="goBack"
    >
      <template #header-extra>
        <InfoTooltip :text="t('voiceCommands.hint')" placement="bottom" />
        <SttLanguagePicker
          placement="bottom"
          align="right"
          :disabled="voice.stage === 'finishing' || voice.stage === 'running'"
          :has-text="hasText"
          @change="handleLanguageChange"
        />
      </template>

      <template #preview>
        <div v-if="voice.stage !== 'running'" class="voice-commands">
          <div
            v-if="contextText"
            class="voice-context"
            :class="{ 'is-unused': isSelectionUnused }"
          >
            <ContextPreview
              v-model:disabled="isContextDisabled"
              editable
              :text="editedContext"
              @update:text="(value) => (editedContext = value)"
            />
            <p v-if="isSelectionUnused" class="voice-context-note">
              {{ t('voiceCommands.selectionUnused') }}
            </p>
          </div>

          <section v-if="isListening" class="voice-listening-bar">
            <div
              class="voice-bar-mic"
              :class="{ 'is-finishing': voice.stage === 'finishing' }"
            >
              <AppIcon
                :icon="
                  voice.stage === 'finishing' ? 'mdi:loading' : 'mdi:microphone'
                "
                :class="{ 'animate-spin': voice.stage === 'finishing' }"
                size="md"
                aria-hidden="true"
              />
            </div>

            <div
              class="voice-bar-transcript"
              :class="{ 'is-editable': canEditText }"
              :title="canEditText ? t('voiceCommands.editTextHint') : undefined"
              @click="editText"
            >
              <LiveTranscript
                class="voice-live-compact"
                :committed="displayTranscript.committed"
                :draft="displayTranscript.draft"
                :placeholder="currentPlaceholder"
              />
            </div>

            <div class="voice-bar-meter">
              <AudioWaveform
                layout="inline"
                status-label=""
                :level="audioLevel"
                :peak="audioPeak"
                :duration-ms="recordingDurationMs"
                :is-transcribing="voice.stage === 'finishing'"
                :auto-stop-deadline-ms="voice.autoStopWarning?.deadlineMs"
              />
            </div>
          </section>

          <div v-if="flowCommand" class="voice-pipeline-bar">
            <div class="voice-pipeline-chip voice-breadcrumb-cmd">
              <AppIcon
                :icon="commandIcon(flowCommand, tools)"
                size="sm"
                aria-hidden="true"
              />
              <span class="voice-pipeline-label">{{
                commandLabel(flowCommand)
              }}</span>
            </div>

            <template v-if="isEditing">
              <template
                v-for="parameter in chosenParameters"
                :key="parameter.name"
              >
                <span class="voice-pipeline-sep" aria-hidden="true">›</span>
                <div
                  v-if="voice.selected?.parameters[parameter.name]"
                  class="voice-pipeline-chip voice-param-chip is-set"
                >
                  <span class="voice-pipeline-label">{{
                    parameterValueDisplayLabel(
                      parameter,
                      voice.selected.parameters[parameter.name],
                      t
                    )
                  }}</span>
                </div>
                <FieldSelect
                  v-else
                  size="sm"
                  class="voice-language"
                  :title="parameterDisplayLabel(parameter, t)"
                  :aria-label="parameterDisplayLabel(parameter, t)"
                  :model-value="voice.selected?.parameters[parameter.name]"
                  :options="voiceParameterOptions(parameter, t)"
                  @update:model-value="
                    (value) =>
                      value && voice.setParameter(parameter.name, String(value))
                  "
                />
              </template>
            </template>
            <template v-else>
              <template v-for="item in liveParameterItems" :key="item.name">
                <span class="voice-pipeline-sep" aria-hidden="true">›</span>
                <div class="voice-pipeline-chip voice-param-chip is-set">
                  <span class="voice-pipeline-label">{{ item.label }}</span>
                </div>
              </template>
              <template v-if="voice.activeParameter">
                <span class="voice-pipeline-sep" aria-hidden="true">›</span>
                <div class="voice-pipeline-chip is-active-step">
                  <span class="voice-pipeline-step-dot" />
                  <span class="voice-pipeline-label">{{
                    parameterDisplayLabel(voice.activeParameter, t)
                  }}</span>
                </div>
              </template>
              <template v-else-if="isCapturingTextPhase">
                <span class="voice-pipeline-sep" aria-hidden="true">›</span>
                <div class="voice-pipeline-chip is-active-step">
                  <span class="voice-pipeline-step-dot" />
                  <span class="voice-pipeline-label">{{
                    voice.activeRunsOnSelection
                      ? t('voiceCommands.selectionAsText')
                      : t('voiceCommands.textPlaceholder')
                  }}</span>
                </div>
              </template>
            </template>
          </div>

          <InlineNotice
            v-if="notice"
            :kind="notice.kind"
            :message="notice.message"
            density="compact"
            announcement="polite"
          >
            <Button
              v-if="canOpenSttSettings"
              size="xs"
              variant="ghost"
              icon="mdi:cog-outline"
              @click="openSttSettings"
            >
              {{ t('common.openSettings') }}
            </Button>
          </InlineNotice>

          <section class="voice-body">
            <template v-if="isEditing">
              <p v-if="voice.isRunningOnSelection" class="voice-on-selection">
                <AppIcon icon="mdi:text-box-check-outline" aria-hidden="true" />
                {{ t('voiceCommands.runsOnSelection') }}
              </p>
              <FieldTextArea
                v-else-if="takesText"
                ref="textRef"
                appearance="plain"
                class="voice-text"
                :model-value="voice.inputText"
                :placeholder="t('voiceCommands.textPlaceholder')"
                :aria-label="t('voiceCommands.textPlaceholder')"
                @update:model-value="(value) => (voice.inputText = value)"
              />
            </template>
            <VoiceParameterPicker
              v-else-if="
                isListening &&
                voice.activeParameter &&
                activeParameterOptions.length
              "
              ref="paramPickerRef"
              :parameter-label="parameterDisplayLabel(voice.activeParameter, t)"
              :options="activeParameterOptions"
              :selected-value="
                voice.activeParameters[voice.activeParameter.name]
              "
              @pick="
                (val) =>
                  voice.activeParameter &&
                  voice.pinParameter(voice.activeParameter.name, val)
              "
              @back="void voice.stepBack()"
            />
            <div
              v-else-if="isCapturingTextPhase"
              class="voice-live-text-container"
            >
              <LiveTranscript
                class="voice-live"
                :committed="displayTranscript.committed"
                :draft="displayTranscript.draft"
                :placeholder="t('voiceCommands.textPlaceholder')"
              />
            </div>
            <VoiceCommandCatalog
              v-else
              ref="catalogComponentRef"
              :commands="voice.catalog"
              :marks="marks"
              :stage="voice.stage"
              :unavailable-reason="voice.unavailableReason"
              @pick="pick"
            />
          </section>
        </div>
      </template>

      <template #actions>
        <div class="voice-actions">
          <ShortcutButton
            v-if="canEditText"
            :keys="['Shift', 'Space']"
            @click="editText"
          >
            {{ t('voiceCommands.editText') }}
          </ShortcutButton>
          <ShortcutButton
            v-if="isListening"
            :keys="withHotkey(['Space', 'Enter'])"
            variant="primary"
            :disabled="!canRunLive || voice.stage === 'finishing'"
            @click="void voice.finish('run')"
          >
            {{
              voice.stage === 'finishing'
                ? t('common.inProgress')
                : t('voiceCommands.run')
            }}
          </ShortcutButton>
          <ShortcutButton
            v-else-if="voice.command"
            :keys="
              withHotkey([
                resolveSubmitKey(desktopStore.userConfig?.editor?.submitKey),
              ])
            "
            variant="primary"
            :disabled="!voice.canRun"
            @click="void voice.run()"
          >
            {{ t('voiceCommands.run') }}
          </ShortcutButton>
        </div>
      </template>
    </ActionOverlayLayout>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import AppIcon from '../components/common/AppIcon.vue'
import Button from '../components/common/Button.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import FieldSelect from '../components/common/FieldSelect.vue'
import FieldTextArea from '../components/common/FieldTextArea.vue'
import InfoTooltip from '../components/common/InfoTooltip.vue'
import InlineNotice from '../components/common/InlineNotice.vue'
import ActionOverlayLayout from '../components/overlay/ActionOverlayLayout.vue'
import ContextPreview from '../components/overlay/ContextPreview.vue'
import ShortcutButton from '../components/overlay/ShortcutButton.vue'
import AudioWaveform from '../components/voice/AudioWaveform.vue'
import LiveTranscript from '../components/voice/LiveTranscript.vue'
import SttLanguagePicker from '../components/voice/SttLanguagePicker.vue'
import VoiceCommandCatalog from '../components/voice/VoiceCommandCatalog.vue'
import VoiceParameterPicker from '../components/voice/VoiceParameterPicker.vue'
import { useI18n } from '../composables/use-i18n'
import { useOverlayNav } from '../composables/use-overlay-nav'
import useToast from '../composables/use-toast'
import { useVoiceFinishSignal } from '../composables/use-voice-finish-signal'
import { useVoiceRecordingMeter } from '../composables/use-voice-recording-meter'
import {
  commandIcon,
  commandLabel,
  commandTakesText,
} from '../lib/commands/command-runtime'
import {
  resolveInputKeyAction,
  resolveSubmitKey,
} from '../lib/input-keys/input-keys'
import { isSettingsFixableDictationError } from '../lib/stt/dictation-error'
import { liveTranscriptText } from '../lib/stt/live-transcript'
import type { TextControl } from '../lib/ui/text-control'
import { matchVoiceCatalog } from '../lib/voice-commands/voice-catalog'
import {
  parameterDisplayLabel,
  parameterValueDisplayLabel,
  pickVoiceCommand,
  resolveVoiceNotice,
  voiceParameterOptions,
  voiceParameters,
} from '../lib/voice-commands/voice-view-presenter'
import { useDesktopStore } from '../stores/desktop'
import { useIpcStore } from '../stores/ipc'
import { MenuModals, useMenuModalsStore } from '../stores/menu-modals'
import { useOperationsStore } from '../stores/operations'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useVoiceCommandsStore } from '../stores/voice-commands'
import { type CommandConfig, commandTakesSelection } from '@tyco/shared'

const props = withDefaults(
  defineProps<{
    text?: string
    shortcutsDisabled?: boolean
    selectionActivationId?: number
  }>(),
  { text: '', shortcutsDisabled: false }
)

const { t } = useI18n()
const { toastKey } = useToast()
const desktopStore = useDesktopStore()
const ipcStore = useIpcStore()
const menuModalsStore = useMenuModalsStore()
const tools = useOperationsStore()
const voice = useVoiceCommandsStore()
const releaseHold = useQuickDismissStore().hold()
const { handleEsc } = useOverlayNav(() => ({ escMode: 'auto' }))

const isContextDisabled = ref(false)

const contextText = computed(() => {
  const state = desktopStore.desktopState
  const text =
    props.selectionActivationId !== undefined &&
    props.selectionActivationId === state.activationId
      ? (state.selectedText ?? props.text)
      : props.text
  return text?.trim() ? text : ''
})

/** The selection as the user corrected it; a new selection replaces it */
const editedContext = ref('')
watch(contextText, (text) => (editedContext.value = text), { immediate: true })

const activeContextText = computed(() =>
  isContextDisabled.value || !editedContext.value.trim()
    ? ''
    : editedContext.value
)

watch(
  activeContextText,
  (text) => {
    voice.setContext(text ? { selectionText: text } : undefined)
  },
  { immediate: true }
)

const textRef = ref<TextControl | null>(null)
const { audioLevel, audioPeak, recordingDurationMs } = useVoiceRecordingMeter(
  () => voice.stage === 'recording'
)

const isListening = computed(
  () => voice.stage === 'recording' || voice.stage === 'finishing'
)

/** The recording stopped on a command: its text and parameters are edited */
const isEditing = computed(
  () => voice.stage === 'review' && Boolean(voice.command)
)
/** The command of the chips: the one heard live, then the one being edited */
const flowCommand = computed(() =>
  isListening.value
    ? voice.activeCommand
    : isEditing.value
      ? voice.command
      : undefined
)
const takesText = computed(() =>
  voice.command ? commandTakesText(voice.command, tools) : false
)

/** The command at hand ignores the selection: it is shown dimmed */
const isSelectionUnused = computed(
  () =>
    Boolean(flowCommand.value) &&
    !isContextDisabled.value &&
    (isEditing.value ? voice.selectionUse : voice.activeSelectionUse) === 'none'
)

/** Rows the recognizer points at: live while recording, the choice after */
const marks = computed(() =>
  matchVoiceCatalog(
    voice.catalog,
    voice.selected
      ? [voice.selected]
      : [
          ...voice.resolution.candidates,
          ...(voice.resolution.parameterChoices ?? []),
        ]
  )
)

const canRunLive = computed(() => Boolean(voice.canRunLive))

const liveParameterItems = computed(() => {
  if (!voice.activeCommand) return []
  return voiceParameters(voice.activeCommand, tools).flatMap((param) => {
    const val = voice.activeParameters[param.name]
    return val
      ? [{ name: param.name, label: parameterValueDisplayLabel(param, val, t) }]
      : []
  })
})

const activeParameterOptions = computed(() =>
  voice.activeParameter ? voiceParameterOptions(voice.activeParameter, t) : []
)

const catalogComponentRef = ref<{
  pickBySlot: (e: KeyboardEvent) => boolean
} | null>(null)
const paramPickerRef = ref<{
  pickBySlot: (e: KeyboardEvent) => boolean
} | null>(null)

const isCapturingTextPhase = computed(
  () =>
    isListening.value && Boolean(voice.activeCommand) && !voice.activeParameter
)

/** The text is spoken now: it can be stopped to correct it by hand */
const canEditText = computed(
  () =>
    voice.stage === 'recording' &&
    isCapturingTextPhase.value &&
    !voice.activeRunsOnSelection &&
    commandTakesText(voice.activeCommand!, tools)
)

/** Stops the recording without running: the recognized text is corrected */
function editText() {
  if (canEditText.value) void voice.finish('review')
}

const currentPlaceholder = computed(() => {
  if (!voice.activeCommand) {
    return t('voiceCommands.phaseAwaitingCommand')
  }
  if (voice.activeParameter) {
    return t('voiceCommands.phaseAwaitingParameter', {
      parameter: parameterDisplayLabel(voice.activeParameter, t),
    })
  }
  return t('voiceCommands.textPlaceholder')
})

function isPlainKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey
}

const displayTranscript = computed(() => {
  const { committed, draft } = voice.liveTranscript
  const offset =
    voice.activeCandidate?.textOffset ??
    voice.resolution.parameterChoices?.[0]?.textOffset ??
    0
  if (!offset) return { committed, draft }
  if (committed.length >= offset) {
    return { committed: committed.slice(offset).trimStart(), draft }
  }
  const rest = offset - committed.length
  return { committed: '', draft: draft.slice(rest).trimStart() }
})

watch(
  () =>
    [
      voice.stage,
      voice.activeCommand,
      voice.activeParameter,
      voice.canRunLive,
    ] as const,
  ([stage, activeCmd, activeParam, canRun]) => {
    if (
      stage === 'recording' &&
      activeCmd &&
      !activeParam &&
      canRun &&
      (!commandTakesText(activeCmd, tools) || voice.activeRunsOnSelection)
    ) {
      void voice.finish('run')
    }
  }
)

/** The parameters of the chosen command the user can set by hand */
const chosenParameters = computed(() =>
  voice.command ? voiceParameters(voice.command, tools) : []
)

const hasText = computed(() =>
  Boolean(liveTranscriptText(voice.liveTranscript).trim())
)

const notice = computed(() =>
  resolveVoiceNotice(
    {
      error: voice.error,
      command: voice.command,
      unavailableReason: voice.unavailableReason,
      inputIssue: voice.inputIssue,
      stage: voice.stage,
      resolutionKind: voice.resolution.kind,
      candidates: voice.resolution.candidates,
      failedParameter: voice.failedParameter,
      isLiveSelectionMissing:
        isListening.value &&
        Boolean(voice.activeCommand) &&
        commandTakesSelection(voice.activeCommand!) &&
        !activeContextText.value.trim(),
    },
    t
  )
)
const canOpenSttSettings = computed(
  () =>
    notice.value?.kind === 'error' &&
    Boolean(voice.error) &&
    isSettingsFixableDictationError(voice.errorCause)
)

function openSttSettings() {
  void ipcStore.callOrNotify('activate_mode', {
    mode: 'config',
    settingsTab: 'stt',
  })
  close()
}

async function handleLanguageChange() {
  // a wrong language is noticed while speaking: the recording starts over
  if (voice.stage === 'recording') {
    const hadText = hasText.value
    await voice.restart()
    if (hadText) toastKey('stt.recordingRestarted', 'info')
    return
  }
  toastKey('stt.languageSavedForNext', 'info')
}

const canPick = (command: CommandConfig) =>
  voice.stage === 'review' && !voice.unavailableReason(command)

/** A row picked by hand takes the recognized parameters when it has them */
const pick = (command: CommandConfig) => {
  if (voice.stage === 'recording' && !voice.unavailableReason(command)) {
    voice.pinCommand(command.id)
    return
  }
  if (
    pickVoiceCommand(command, {
      canPick,
      marks: marks.value,
      selected: voice.selected,
      choose: voice.choose,
      chooseCommand: voice.chooseCommand,
    })
  ) {
    void nextTick(() => textRef.value?.focus())
  }
}

const close = () => {
  void voice.cancel()
  handleEsc()
}

/** Back goes a step back in the command, then leaves the window */
async function goBack() {
  if (!(await voice.stepBack())) close()
}

let runningPendingOwner: number | undefined

const syncRunningPending = () => {
  if (voice.stage === 'running') {
    runningPendingOwner = menuModalsStore.setPendingModal(
      {
        label: t('commands.running', {
          name: voice.command ? commandLabel(voice.command) : '',
        }),
        // Esc during a run aborts it and stays on its review
        onCancel: () => voice.cancelRun(),
      },
      runningPendingOwner
    )
  } else if (runningPendingOwner !== undefined) {
    menuModalsStore.clearPendingModal(runningPendingOwner)
    runningPendingOwner = undefined
  }
}

watch(
  () => [voice.stage, voice.command] as const,
  async ([stage], previous) => {
    syncRunningPending()
    if (stage === 'review' && previous?.[0] === 'finishing') {
      await nextTick()
      textRef.value?.focus()
    }
  },
  { immediate: true }
)

watch(
  () => desktopStore.desktopState.isWindowShown,
  (shown) => {
    if (!shown) void voice.cancel()
  }
)

/**
 * The hotkey that opened the overlay presses its Run button: it stops the
 * recording and runs a recognized command, or runs the reviewed one.
 */
const finishHotkey = useVoiceFinishSignal(
  () => 'voiceCommands',
  () => {
    if (voice.stage === 'recording') void voice.finish('run')
    else if (voice.stage === 'review') void voice.run()
  },
  // Push-to-Talk: letting go stops the recording; it never runs a review
  () => {
    if (voice.stage === 'recording') void voice.finish('run')
  }
)
const withHotkey = (keys: string[]) =>
  finishHotkey.value ? [...keys, finishHotkey.value] : keys

const onKeyDown = (event: KeyboardEvent) => {
  // Enter that confirms an IME composition belongs to the text
  if (event.repeat || event.isComposing || event.keyCode === 229) return
  if (
    props.shortcutsDisabled ||
    (menuModalsStore.hasOpenModal &&
      menuModalsStore.currentModal !== MenuModals.VOICE_COMMANDS)
  )
    return
  if (voice.stage === 'running') return
  // Escape belongs to `ActionOverlayLayout`, which calls `close`
  if (voice.stage === 'recording') {
    if (event.ctrlKey || event.metaKey || event.altKey) return
    if (event.code === 'Space' && event.shiftKey) {
      event.preventDefault()
      editText()
      return
    } else if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault()
      if (canRunLive.value) {
        void voice.finish('run')
      }
      return
    } else if (event.key === 'Backspace') {
      if (voice.canStepBack) {
        event.preventDefault()
        void voice.stepBack()
        return
      }
    }

    if (!event.repeat && isPlainKey(event)) {
      if (voice.activeParameter && paramPickerRef.value?.pickBySlot(event)) {
        event.preventDefault()
        return
      } else if (
        !voice.activeCommand &&
        catalogComponentRef.value?.pickBySlot(event)
      ) {
        event.preventDefault()
        return
      }
    }
    return
  }
  if (voice.stage !== 'review') return
  // a focused row takes Enter itself; Shift+Enter starts a new line
  const isOnRow = (event.target as HTMLElement | null)?.closest?.(
    '.voice-entry'
  )
  if (
    resolveInputKeyAction(
      event,
      resolveSubmitKey(desktopStore.userConfig?.editor?.submitKey)
    ) === 'submit' &&
    !isOnRow
  ) {
    event.preventDefault()
    void voice.run()
  }
}

onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  void voice.start()
})
onUnmounted(() => {
  window.removeEventListener('keydown', onKeyDown)
  if (runningPendingOwner !== undefined) {
    menuModalsStore.clearPendingModal(runningPendingOwner)
    runningPendingOwner = undefined
  }
  releaseHold()
  voice.setContext(undefined)
  void voice.cancel()
})
</script>

<style scoped>
/* a long selection must not push the transcript and the commands away */
.voice-context {
  display: flex;
  flex-direction: column;
  flex: 0 0 auto;
  gap: var(--space-2xs);
  max-height: min(9rem, 35%);
  min-height: 0;
}

.voice-context > :first-child {
  flex: 1 1 auto;
  min-height: 0;
  max-height: 100%;
  overflow: auto;
}

.voice-context.is-unused > :first-child {
  opacity: 0.5;
}

.voice-context-note,
.voice-on-selection {
  margin: 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.voice-on-selection {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: var(--space-sm);
}

.voice-bar-transcript.is-editable {
  cursor: text;
}

.voice-commands {
  display: flex;
  flex-direction: column;
  height: 100%;
  min-height: 0;
}

.voice-listening-bar {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border-bottom: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
  min-height: 2.75rem;
  box-sizing: border-box;
}

.voice-bar-mic {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  border-radius: 50%;
  background-color: color-mix(in oklab, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
  flex-shrink: 0;
}

.voice-bar-mic.is-finishing {
  color: var(--app-text-muted);
  background-color: transparent;
}

.voice-bar-transcript {
  flex: 1 1 0%;
  min-width: 0;
  display: flex;
  align-items: center;
}

.voice-live-compact {
  width: 100%;
  min-width: 0;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.voice-bar-meter {
  flex-shrink: 0;
  display: flex;
  align-items: center;
}

.voice-pipeline-bar {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  padding: 0.375rem var(--space-sm);
  background-color: var(--app-surface-sunken, rgba(0, 0, 0, 0.15));
  border-bottom: 1px solid var(--app-border-subtle);
  overflow-x: auto;
  white-space: nowrap;
  min-height: 2.25rem;
  box-sizing: border-box;
}

.voice-pipeline-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.2rem 0.5rem;
  border-radius: var(--radius-sm);
  border: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
  color: var(--color-base-content);
  font-size: var(--text-caption);
  font-weight: 500;
  cursor: default;
  user-select: none;
}

.voice-pipeline-chip.is-set {
  background-color: color-mix(in oklab, var(--color-primary) 12%, transparent);
  border-color: color-mix(in oklab, var(--color-primary) 40%, transparent);
  color: var(--color-primary);
}

.voice-pipeline-chip.is-active-step {
  cursor: default;
  background-color: transparent;
  border: 1px dashed var(--color-primary);
  color: var(--color-primary);
}

.voice-pipeline-step-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background-color: var(--color-primary);
}

.voice-pipeline-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-pipeline-sep {
  color: var(--app-text-muted);
  font-size: var(--text-body);
  user-select: none;
}

.voice-body {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
}

.voice-live-text-container {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  padding: var(--space-md);
}

.voice-live {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  font-size: var(--text-lead);
  line-height: 1.5;
}

.voice-language {
  width: auto;
  max-width: 14rem;
}

.voice-text {
  flex: 1 1 0%;
  min-height: 4rem;
  padding: var(--space-md);
  font-size: var(--text-lead);
  line-height: 1.5;
  resize: none;
}

.voice-actions {
  justify-content: flex-end;
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  --shortcut-flex: 0 0 auto;
  --shortcut-width: auto;
}
</style>
