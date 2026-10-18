<template>
  <ContentPadding>
    <ActionOverlayLayout :title="t('voiceCommands.title')" :on-esc="close">
      <template #header-extra>
        <InfoTooltip :text="t('voiceCommands.hint')" placement="bottom" />
      </template>

      <template #preview>
        <div class="voice-commands">
          <section class="voice-main">
            <template v-if="isListening">
              <div v-if="voice.activeCommand" class="voice-chosen">
                <AppIcon
                  :icon="commandIcon(voice.activeCommand, tools)"
                  size="xl"
                  aria-hidden="true"
                />
                <span class="voice-chosen-name">{{ liveChosenName }}</span>
                <Badge v-if="liveLanguageBadge" tone="accent">{{
                  liveLanguageBadge
                }}</Badge>
              </div>
              <p v-else class="voice-phase-hint">
                <AppIcon icon="mdi:microphone" size="md" aria-hidden="true" />
                <span>{{ t('voiceCommands.phaseAwaitingCommand') }}</span>
              </p>
              <AudioWaveform
                :level="audioLevel"
                :peak="audioPeak"
                :duration-ms="recordingDurationMs"
                :is-transcribing="voice.stage === 'finishing'"
              />
              <LiveTranscript
                class="voice-live"
                :committed="voice.liveTranscript.committed"
                :draft="voice.liveTranscript.draft"
              />
            </template>

            <StateMessage
              v-else-if="voice.stage === 'running'"
              kind="loading"
              :message="
                t('commandLauncher.running', {
                  name: voice.command ? commandLabel(voice.command) : '',
                })
              "
            />

            <template v-else>
              <div v-if="voice.command" class="voice-chosen">
                <AppIcon
                  :icon="commandIcon(voice.command, tools)"
                  size="xl"
                  aria-hidden="true"
                />
                <span class="voice-chosen-name">{{ chosenName }}</span>
                <FieldSelect
                  v-if="isTranslationCommand(voice.command)"
                  size="sm"
                  class="voice-language"
                  :title="t('commands.languageLabel')"
                  :aria-label="t('commands.languageLabel')"
                  :model-value="voice.command.id"
                  :options="languageOptions"
                  @update:model-value="
                    (id) => id && voice.switchCommand(String(id))
                  "
                />
              </div>
              <code v-if="target" class="voice-target">{{ target }}</code>
              <InlineNotice
                v-if="notice"
                :kind="notice.kind"
                :message="notice.message"
                density="compact"
                announcement="polite"
              />
              <FieldTextArea
                ref="textRef"
                class="voice-text"
                :model-value="voice.inputText"
                :placeholder="t('voiceCommands.textPlaceholder')"
                :aria-label="t('voiceCommands.textPlaceholder')"
                @update:model-value="(value) => (voice.inputText = value)"
              />
            </template>
          </section>

          <VoiceCommandCatalog
            :entries="entries"
            :marks="marks"
            :routes="voice.catalogRoutes"
            :stage="voice.stage"
            :unavailable-reason="voice.unavailableReason"
            @pick="pick"
          />
        </div>
      </template>

      <template #actions>
        <div class="voice-actions">
          <template v-if="isListening">
            <ShortcutButton
              :keys="withHotkey(['Space', 'Enter'])"
              icon="mdi:play"
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
              :keys="['Tab']"
              icon="mdi:pencil-outline"
              :disabled="!hasMatchedCommand || voice.stage === 'finishing'"
              @click="void voice.finish('review')"
            >
              {{ t('voiceCommands.edit') }}
            </ShortcutButton>
          </template>
          <template v-else>
            <ShortcutButton
              :keys="withHotkey(['Enter'])"
              icon="mdi:play"
              variant="primary"
              :disabled="!voice.canRun"
              @click="void voice.run()"
            >
              {{ t('voiceCommands.run') }}
            </ShortcutButton>
          </template>
        </div>
      </template>
    </ActionOverlayLayout>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import AppIcon from '../components/common/AppIcon.vue'
import Badge from '../components/common/Badge.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import FieldSelect from '../components/common/FieldSelect.vue'
import FieldTextArea from '../components/common/FieldTextArea.vue'
import InfoTooltip from '../components/common/InfoTooltip.vue'
import InlineNotice from '../components/common/InlineNotice.vue'
import StateMessage from '../components/common/StateMessage.vue'
import ActionOverlayLayout from '../components/overlay/ActionOverlayLayout.vue'
import ShortcutButton from '../components/overlay/ShortcutButton.vue'
import AudioWaveform from '../components/voice/AudioWaveform.vue'
import LiveTranscript from '../components/voice/LiveTranscript.vue'
import VoiceCommandCatalog from '../components/voice/VoiceCommandCatalog.vue'
import { useI18n } from '../composables/use-i18n'
import { useOverlayNav } from '../composables/use-overlay-nav'
import { useVoiceFinishSignal } from '../composables/use-voice-finish-signal'
import { useVoiceRecordingMeter } from '../composables/use-voice-recording-meter'
import {
  commandIcon,
  commandLabel,
  commandTarget,
} from '../lib/commands/command-runtime'
import type { TextControl } from '../lib/ui/text-control'
import {
  type VoiceCatalogEntry,
  buildVoiceCatalog,
  isTranslateEntry,
  matchVoiceCatalog,
} from '../lib/voice-commands/voice-catalog'
import {
  DEFAULT_TRANSLATION_ID,
  isTranslationCommand,
  pickVoiceCatalogEntry,
  resolveVoiceNotice,
  voiceCommandLanguageLabel,
} from '../lib/voice-commands/voice-view-presenter'
import { useDesktopStore } from '../stores/desktop'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useToolsStore } from '../stores/tools'
import { useVoiceCommandsStore } from '../stores/voice-commands'

const { t } = useI18n()
const desktopStore = useDesktopStore()
const tools = useToolsStore()
const voice = useVoiceCommandsStore()
const releaseHold = useQuickDismissStore().hold()
const { handleEsc } = useOverlayNav(() => ({ escMode: 'close' }))

const textRef = ref<TextControl | null>(null)
const { audioLevel, audioPeak, recordingDurationMs } = useVoiceRecordingMeter(
  () => voice.stage === 'recording'
)

const isListening = computed(
  () => voice.stage === 'recording' || voice.stage === 'finishing'
)

const entries = computed(() =>
  buildVoiceCatalog(voice.catalog, DEFAULT_TRANSLATION_ID)
)

/** Rows the recognizer points at: live while recording, the choice after */
const marks = computed(() =>
  matchVoiceCatalog(
    entries.value,
    voice.selected
      ? [voice.selected]
      : [
          ...voice.resolution.candidates,
          ...(voice.resolution.parameterChoices ?? []),
        ]
  )
)

const translateEntry = computed(() => entries.value.find(isTranslateEntry))
const languageOptions = computed(() =>
  (translateEntry.value?.commands ?? []).map((command) => ({
    id: command.id,
    name: voiceCommandLanguageLabel(command, t),
  }))
)

const hasMatchedCommand = computed(() => Boolean(voice.hasMatchedCommand))
const canRunLive = computed(() => Boolean(voice.canRunLive))

const liveChosenName = computed(() => {
  const command = voice.activeCommand
  if (!command) return ''
  return isTranslationCommand(command)
    ? t('tools.translate')
    : commandLabel(command)
})
const liveLanguageBadge = computed(() => {
  const command = voice.activeCommand
  if (!command || !isTranslationCommand(command)) return ''
  return voiceCommandLanguageLabel(command, t)
})

const chosenName = computed(() => {
  const command = voice.command
  if (!command) return ''
  return isTranslationCommand(command)
    ? t('tools.translate')
    : commandLabel(command)
})
const target = computed(() =>
  voice.command ? commandTarget(voice.command).trim() : ''
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
    },
    t
  )
)

const canPick = (entry: VoiceCatalogEntry) =>
  voice.stage === 'review' && !voice.unavailableReason(entry.commands[0]!)

/** A row picked by hand takes the recognized parameters when it has them */
const pick = (entry: VoiceCatalogEntry) => {
  if (
    pickVoiceCatalogEntry(entry, {
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

watch(
  () => voice.stage,
  async (stage, previous) => {
    if (stage === 'review' && previous === 'finishing') {
      await nextTick()
      textRef.value?.focus()
    }
  }
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
  }
)
const withHotkey = (keys: string[]) =>
  finishHotkey.value ? [...keys, finishHotkey.value] : keys

const onKeyDown = (event: KeyboardEvent) => {
  if (event.repeat) return
  if (event.code === 'Escape') {
    event.preventDefault()
    close()
    return
  }
  if (voice.stage === 'recording') {
    if (event.code === 'Tab') {
      event.preventDefault()
      if (hasMatchedCommand.value) {
        void voice.finish('review')
      }
    } else if (event.code === 'Space' || event.code === 'Enter') {
      event.preventDefault()
      if (canRunLive.value) {
        void voice.finish('run')
      }
    }
    return
  }
  if (voice.stage !== 'review') return
  // a focused row takes Enter itself; Shift+Enter starts a new line
  const isOnRow = (event.target as HTMLElement | null)?.closest?.(
    '.voice-entry'
  )
  if (event.code === 'Enter' && !event.shiftKey && !isOnRow) {
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
  releaseHold()
  void voice.cancel()
})
</script>

<style scoped>
.voice-commands {
  display: grid;
  grid-template-columns: minmax(0, 3fr) minmax(0, 2fr);
  height: 100%;
  min-height: 0;
}

.voice-main {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
  min-height: 0;
  padding: var(--space-sm);
}

.voice-phase-hint {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  margin: 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.voice-live {
  flex: 1 1 0%;
  min-height: 0;
  overflow-y: auto;
}

.voice-chosen {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  font-size: var(--text-title);
  font-weight: 600;
}

.voice-chosen-name {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-language {
  width: auto;
  max-width: 14rem;
  margin-left: auto;
  font-weight: 400;
}

.voice-target {
  flex-shrink: 0;
  max-height: 4.5rem;
  overflow: auto;
  padding: 0.375rem 0.5rem;
  border-radius: var(--radius-sm);
  background-color: var(--app-surface-sunken);
  color: var(--app-text-muted);
  font-size: var(--text-caption);
  white-space: pre-wrap;
  word-break: break-all;
}

.voice-text {
  flex: 1 1 0%;
  min-height: 4rem;
  resize: none;
}

.voice-actions {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  --shortcut-flex: 0 0 auto;
  --shortcut-width: auto;
}

@container (max-width: 600px) {
  .voice-commands {
    grid-template-columns: 1fr;
    grid-template-rows: minmax(0, 3fr) minmax(0, 2fr);
  }
}
</style>
