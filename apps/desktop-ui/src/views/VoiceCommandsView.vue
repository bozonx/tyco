<template>
  <ContentPadding>
    <ActionOverlayLayout :title="t('voiceCommands.title')" :onEsc="close">
      <template #header-extra>
        <InfoTooltip :text="t('voiceCommands.hint')" placement="bottom" />
      </template>

      <template #preview>
        <div class="voice-commands">
          <section class="voice-main">
            <template v-if="isListening">
              <div v-if="voice.activeCommand" class="voice-chosen">
                <Icon
                  :icon="commandIcon(voice.activeCommand, tools)"
                  height="20"
                  aria-hidden="true"
                />
                <span class="voice-chosen-name">{{ liveChosenName }}</span>
                <Badge v-if="liveLanguageBadge" tone="accent">{{
                  liveLanguageBadge
                }}</Badge>
              </div>
              <p v-else class="voice-phase-hint">
                <Icon icon="mdi:microphone" height="16" aria-hidden="true" />
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
                <Icon
                  :icon="commandIcon(voice.command, tools)"
                  height="20"
                  aria-hidden="true"
                />
                <span class="voice-chosen-name">{{ chosenName }}</span>
                <FieldSelect
                  v-if="isTranslation(voice.command)"
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
              <p v-if="voice.discardedText" class="voice-discarded">
                <span class="voice-discarded-label">{{
                  t('voiceCommands.discarded')
                }}</span>
                <del>{{ voice.discardedText }}</del>
              </p>
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

          <section
            ref="catalogRef"
            class="voice-catalog"
            :aria-label="t('voiceCommands.catalog')"
            @keydown="onCatalogKeyDown"
          >
            <template v-for="group in groups" :key="group.id">
              <h2 class="voice-group">{{ group.label }}</h2>
              <button
                v-for="entry in group.entries"
                :key="entry.key"
                type="button"
                class="voice-entry"
                :class="{
                  'is-marked': marks.has(entry.key),
                  'is-pickable': canPick(entry),
                  'is-unavailable': unavailable(entry),
                }"
                :data-key="entry.key"
                :aria-current="marks.has(entry.key) || undefined"
                :aria-disabled="!canPick(entry) || undefined"
                :title="entry.commands[0]!.description || undefined"
                @click="pick(entry)"
              >
                <Icon
                  class="voice-entry-icon"
                  :icon="commandIcon(entry.commands[0]!, tools)"
                  height="18"
                  aria-hidden="true"
                />
                <span class="voice-entry-body">
                  <span class="voice-entry-name">
                    {{ entryLabel(entry) }}
                    <Badge
                      v-if="marks.has(entry.key) && entryLanguage(entry)"
                      tone="accent"
                      >{{ entryLanguage(entry) }}</Badge
                    >
                  </span>
                  <span
                    v-for="phrase in entryPhrases(entry)"
                    :key="phrase"
                    class="voice-entry-phrase"
                    >{{ phrase }}</span
                  >
                </span>
                <Icon
                  v-if="unavailable(entry)"
                  class="voice-entry-warning"
                  icon="mdi:alert-circle-outline"
                  height="16"
                  :title="t(unavailable(entry)!)"
                  :aria-label="t(unavailable(entry)!)"
                />
              </button>
              <p
                v-if="group.id === 'custom' && !group.entries.length"
                class="voice-empty"
              >
                {{ t('voiceCommands.empty') }}
              </p>
            </template>
          </section>
        </div>
      </template>

      <template #actions>
        <div class="voice-actions">
          <template v-if="isListening">
            <ShortcutButton
              :keys="['Space', 'Enter']"
              icon="mdi:play"
              variant="primary"
              :disabled="!hasMatchedCommand || voice.stage === 'finishing'"
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
              :keys="['Enter']"
              icon="mdi:play"
              variant="primary"
              :disabled="!voice.canRun"
              @click="void voice.run()"
            >
              {{ t('voiceCommands.run') }}
            </ShortcutButton>
            <ShortcutButton
              :keys="['Ctrl', 'R']"
              icon="mdi:microphone"
              :disabled="voice.stage === 'running'"
              @click="void voice.start()"
            >
              {{ t('voiceCommands.record') }}
            </ShortcutButton>
          </template>
        </div>
      </template>
    </ActionOverlayLayout>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'

import ActionOverlayLayout from '../components/common/ActionOverlayLayout.vue'
import Icon from '../components/common/AppIcon.vue'
import Badge from '../components/common/Badge.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import FieldSelect from '../components/common/FieldSelect.vue'
import FieldTextArea from '../components/common/FieldTextArea.vue'
import InfoTooltip from '../components/common/InfoTooltip.vue'
import InlineNotice from '../components/common/InlineNotice.vue'
import ShortcutButton from '../components/common/ShortcutButton.vue'
import StateMessage from '../components/common/StateMessage.vue'
import AudioWaveform from '../components/voice/AudioWaveform.vue'
import LiveTranscript from '../components/voice/LiveTranscript.vue'
import { useI18n } from '../composables/use-i18n'
import { useOverlayNav } from '../composables/use-overlay-nav'
import {
  commandIcon,
  commandLabel,
  commandTarget,
} from '../lib/commands/command-runtime'
import { desktopClient } from '../lib/desktop/client'
import { getLanguageLabelKey } from '../lib/locale/language'
import type { TextControl } from '../lib/ui/text-control'
import {
  type VoiceCatalogEntry,
  buildVoiceCatalog,
  isTranslateEntry,
  matchVoiceCatalog,
} from '../lib/voice-commands/voice-catalog'
import type { VoiceCandidate } from '../lib/voice-commands/voice-resolver'
import { useIpcStore } from '../stores/ipc'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useToolsStore } from '../stores/tools'
import { useVoiceCommandsStore } from '../stores/voice-commands'
import type { CommandConfig } from '@tyco/shared'
import { DESKTOP_EVENTS } from '@tyco/shared'

const DEFAULT_TRANSLATION_ID = 'builtin:voice:translate:en_US'

const { t } = useI18n()
const ipc = useIpcStore()
const tools = useToolsStore()
const voice = useVoiceCommandsStore()
const releaseHold = useQuickDismissStore().hold()
const { handleEsc } = useOverlayNav(() => ({ escMode: 'close' }))

const textRef = ref<TextControl | null>(null)
const catalogRef = ref<HTMLElement | null>(null)
const audioLevel = ref(0)
const audioPeak = ref(0)
const recordingDurationMs = ref(0)

const isListening = computed(
  () => voice.stage === 'recording' || voice.stage === 'finishing'
)

const entries = computed(() =>
  buildVoiceCatalog(voice.catalog, DEFAULT_TRANSLATION_ID)
)
const groups = computed(() => [
  {
    id: 'builtIn',
    label: t('voiceCommands.builtInCatalog'),
    entries: entries.value.filter((entry) => entry.group === 'builtIn'),
  },
  {
    id: 'custom',
    label: t('voiceCommands.customCatalog'),
    entries: entries.value.filter((entry) => entry.group === 'custom'),
  },
])

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

const isTranslation = (command: CommandConfig) =>
  command.toolId === 'core.translate' && command.id.startsWith('builtin:')
const languageLabel = (command: CommandConfig) =>
  t(getLanguageLabelKey(String(command.toolConfig.language)))
const translateEntry = computed(() => entries.value.find(isTranslateEntry))
const languageOptions = computed(() =>
  (translateEntry.value?.commands ?? []).map((command) => ({
    id: command.id,
    name: languageLabel(command),
  }))
)

const entryLabel = (entry: VoiceCatalogEntry) =>
  entry.group === 'custom'
    ? commandLabel(entry.commands[0]!)
    : isTranslateEntry(entry)
      ? t('tools.translate')
      : t('tools.askInChat')
const entryLanguage = (entry: VoiceCatalogEntry) => {
  if (!isTranslateEntry(entry)) return ''
  const id = marks.value.get(entry.key)?.commandId
  const command = entry.commands.find((item) => item.id === id)
  return command ? languageLabel(command) : ''
}
const entryPhrases = (entry: VoiceCatalogEntry) => {
  const text = t('voiceCommands.textPlaceholder')
  if (isTranslateEntry(entry))
    return [
      `${t('voiceGrammar.translate')} ${t('voiceCommands.languagePlaceholder')} ${text}`,
    ]
  if (entry.group === 'builtIn')
    return [`${t('voiceGrammar.actions.askInChat')} ${text}`]
  return [
    ...new Set(
      voice.catalogRoutes
        .filter((route) => route.commandId === entry.key)
        .map((route) =>
          [
            route.phrase,
            ...route.parameters.map((parameter) =>
              parameter.variants.join(' / ')
            ),
          ].join(' ')
        )
    ),
  ]
}
const unavailable = (entry: VoiceCatalogEntry) =>
  voice.unavailableReason(entry.commands[0]!)
// rows stay focusable and keep their hints while they cannot be picked
const canPick = (entry: VoiceCatalogEntry) =>
  voice.stage === 'review' && !unavailable(entry)

const hasMatchedCommand = computed(() => Boolean(voice.hasMatchedCommand))

const liveChosenName = computed(() => {
  const command = voice.activeCommand
  if (!command) return ''
  return isTranslation(command) ? t('tools.translate') : commandLabel(command)
})
const liveLanguageBadge = computed(() => {
  const command = voice.activeCommand
  if (!command || !isTranslation(command)) return ''
  return languageLabel(command)
})

const chosenName = computed(() => {
  const command = voice.command
  if (!command) return ''
  return isTranslation(command) ? t('tools.translate') : commandLabel(command)
})
const target = computed(() =>
  voice.command ? commandTarget(voice.command).trim() : ''
)

const notice = computed<
  { kind: 'info' | 'warning' | 'error'; message: string } | undefined
>(() => {
  if (voice.error) {
    const key = voice.error
    return {
      kind: 'error',
      message: key.startsWith('voiceCommands.') ? t(key) : key,
    }
  }
  if (voice.command) {
    const reason = voice.unavailableReason(voice.command)
    if (reason) return { kind: 'warning', message: t(reason) }
    if (voice.inputIssue)
      return {
        kind: 'warning',
        message:
          voice.inputIssue === 'missing-text'
            ? t('voiceCommands.missingText')
            : t('voiceCommands.extraText'),
      }
    return undefined
  }
  if (voice.stage !== 'review') return undefined
  const kind = voice.resolution.kind
  if (kind === 'ambiguous')
    return { kind: 'info', message: t('voiceCommands.ambiguous') }
  if (kind === 'parameter-error')
    return { kind: 'info', message: t('voiceCommands.languageMissing') }
  return { kind: 'info', message: t('voiceCommands.noMatch') }
})

/** A row picked by hand takes the recognized parameters when it has them */
const pick = (entry: VoiceCatalogEntry) => {
  if (!canPick(entry)) return
  const candidate: VoiceCandidate | undefined = marks.value.get(entry.key)
  if (candidate && candidate !== voice.selected) voice.choose(candidate)
  else if (!candidate) voice.chooseCommand(entry.commands[0]!.id)
  void nextTick(() => textRef.value?.focus())
}

const close = () => {
  void voice.cancel()
  handleEsc()
}

// the marked row may sit below the fold of a long list
watch(
  () => [...marks.value.keys()][0],
  async (key) => {
    if (!key) return
    await nextTick()
    catalogRef.value
      ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
  }
)

watch(
  () => voice.stage,
  async (stage, previous) => {
    if (stage === 'review' && previous === 'finishing') {
      await nextTick()
      textRef.value?.focus()
    }
  }
)

let durationTimer: ReturnType<typeof setInterval> | undefined
watch(
  () => voice.stage === 'recording',
  (isRecording) => {
    if (durationTimer) clearInterval(durationTimer)
    durationTimer = undefined
    if (!isRecording) return
    const startedAt = Date.now()
    recordingDurationMs.value = 0
    durationTimer = setInterval(() => {
      recordingDurationMs.value = Date.now() - startedAt
    }, 250)
  },
  { immediate: true }
)

watch(
  () => ipc.desktopState.isWindowShown,
  (shown) => {
    if (!shown) void voice.cancel()
  }
)

const onCatalogKeyDown = (event: KeyboardEvent) => {
  if (event.code !== 'ArrowDown' && event.code !== 'ArrowUp') return
  const rows = [
    ...(catalogRef.value?.querySelectorAll<HTMLButtonElement>('.voice-entry') ??
      []),
  ]
  if (!rows.length) return
  event.preventDefault()
  const index = rows.indexOf(document.activeElement as HTMLButtonElement)
  const step = event.code === 'ArrowDown' ? 1 : -1
  rows[(index + step + rows.length) % rows.length]?.focus()
}

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
      if (hasMatchedCommand.value) {
        void voice.finish('run')
      }
    }
    return
  }
  if (voice.stage !== 'review') return
  if ((event.ctrlKey || event.metaKey) && event.code === 'KeyR') {
    event.preventDefault()
    void voice.start()
    return
  }
  // a focused row takes Enter itself; Shift+Enter starts a new line
  const isOnRow = (event.target as HTMLElement | null)?.closest?.(
    '.voice-entry'
  )
  if (event.code === 'Enter' && !event.shiftKey && !isOnRow) {
    event.preventDefault()
    void voice.run()
  }
}

let unlisten: (() => void)[] = []
let unmounted = false
const keep = (stop: () => void) => {
  if (unmounted) stop()
  else unlisten.push(stop)
}
onMounted(() => {
  window.addEventListener('keydown', onKeyDown)
  void desktopClient
    .listen(DESKTOP_EVENTS.VOICE_COMMAND_FINISH, (id) => {
      if (
        id === ipc.desktopState.activationId &&
        ipc.desktopState.isWindowShown
      )
        void voice.finish()
    })
    .then(keep)
    .catch(() => undefined)
  // the level meter is decoration: the recording must not wait for it
  void desktopClient
    .listen(DESKTOP_EVENTS.VOICE_AUDIO_LEVEL, (payload) => {
      audioLevel.value = payload.level
      audioPeak.value = payload.peak
    })
    .then(keep)
    .catch(() => undefined)
  void voice.start()
})
onUnmounted(() => {
  unmounted = true
  for (const stop of unlisten) stop()
  unlisten = []
  if (durationTimer) clearInterval(durationTimer)
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
  font-size: 1rem;
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

.voice-discarded {
  flex-shrink: 0;
  max-height: 4.5rem;
  margin: 0;
  overflow-y: auto;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  overflow-wrap: anywhere;
}

.voice-discarded-label {
  margin-right: var(--space-xs);
  font-weight: 600;
}

.voice-text {
  flex: 1 1 0%;
  min-height: 4rem;
  resize: none;
}

.voice-catalog {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-xs);
  border-left: 1px solid var(--app-border-subtle);
}

.voice-group {
  margin: var(--space-sm) var(--space-sm) var(--space-xs);
  font-size: var(--text-caption);
  font-weight: 600;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--app-text-muted);
}

.voice-group:first-child {
  margin-top: var(--space-xs);
}

.voice-entry {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  width: 100%;
  padding: 0.375rem var(--space-sm);
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  background: transparent;
  color: var(--color-base-content);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.voice-entry.is-pickable:hover {
  background-color: var(--app-hover);
}

.voice-entry:focus-visible {
  outline: none;
  box-shadow: var(--app-focus-ring);
}

.voice-entry:not(.is-pickable) {
  cursor: default;
}

.voice-entry.is-marked {
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
  background-color: color-mix(in oklab, var(--color-primary) 12%, transparent);
}

.voice-entry.is-unavailable {
  opacity: 0.55;
}

.voice-entry-icon {
  flex-shrink: 0;
  margin-top: 0.125rem;
  color: var(--app-text-muted);
}

.voice-entry.is-marked .voice-entry-icon {
  color: var(--color-primary);
}

.voice-entry-body {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
  flex: 1 1 auto;
}

.voice-entry-name {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  font-weight: 500;
  overflow-wrap: anywhere;
}

.voice-entry-phrase {
  font-family: var(--font-mono);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  overflow-wrap: anywhere;
}

.voice-entry-warning {
  flex-shrink: 0;
  margin-top: 0.125rem;
  color: var(--color-warning);
}

.voice-empty {
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
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

  .voice-catalog {
    border-left: none;
    border-top: 1px solid var(--app-border-subtle);
  }
}
</style>
