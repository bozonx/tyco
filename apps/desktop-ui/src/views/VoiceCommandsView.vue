<template>
  <ContentPadding>
    <ActionOverlayLayout :title="t('voiceCommands.title')" :onEsc="close">
      <div class="voice-commands">
        <section class="voice-input">
          <p>{{ t('voiceCommands.hint') }}</p>
          <p role="status" aria-live="polite">{{ status }}</p>
          <label>
            {{ t('voiceCommands.transcript') }}
            <textarea
              :value="voice.transcript"
              :disabled="voice.stage !== 'review'"
              @input="
                voice.editTranscript(
                  ($event.target as HTMLTextAreaElement).value
                )
              "
            />
          </label>
          <div
            v-for="candidate in voice.resolution.candidates"
            :key="`${candidate.commandId}:${candidate.textOffset}`"
            class="voice-candidate"
          >
            <button
              :disabled="voice.stage !== 'review'"
              @click="voice.choose(candidate)"
            >
              {{ label(candidate.commandId) }}
              <span v-for="(value, name) in candidate.parameters" :key="name">
                · {{ value }}</span
              >
            </button>
            <p>{{ candidate.text }}</p>
          </div>
          <div v-if="voice.resolution.parameterChoices?.length">
            <p>{{ t('voiceCommands.parameterChoiceHint') }}</p>
            <button
              v-for="candidate in voice.resolution.parameterChoices"
              :key="`${candidate.commandId}:${candidate.textOffset}`"
              :disabled="voice.stage !== 'review'"
              @click="voice.choose(candidate)"
            >
              {{ label(candidate.commandId) }}
              <span v-for="(value, name) in candidate.parameters" :key="name">
                · {{ value }}
              </span>
            </button>
          </div>
          <template v-if="voice.command && voice.selected">
            <strong>{{ commandLabel(voice.command) }}</strong>
            <code v-if="commandTarget(voice.command)">{{
              commandTarget(voice.command)
            }}</code>
            <label
              >{{ t('voiceCommands.input') }}
              <textarea
                v-model="voice.inputText"
                :disabled="voice.stage !== 'review'"
              />
            </label>
            <p v-if="voice.inputIssue" role="alert">
              {{
                voice.inputIssue === 'missing-text'
                  ? t('voiceCommands.missingText')
                  : t('voiceCommands.extraText')
              }}
            </p>
          </template>
          <p v-if="voice.error" role="alert">
            {{
              voice.error === 'voiceCommands.failed'
                ? t('voiceCommands.failed')
                : voice.error === 'voiceCommands.none'
                  ? t('voiceCommands.none')
                  : voice.error
            }}
          </p>
          <div class="voice-controls">
            <button
              v-if="voice.stage === 'recording'"
              @click="void voice.finish()"
            >
              {{ t('voiceCommands.stop') }}
            </button>
            <button
              v-if="voice.stage === 'review' || voice.stage === 'idle'"
              @click="void voice.start()"
            >
              {{ t('voiceCommands.record') }}
            </button>
            <button
              v-if="voice.selected"
              :disabled="!voice.canRun"
              @click="void voice.run()"
            >
              {{ t('voiceCommands.run') }}
            </button>
            <button @click="close">{{ t('voiceCommands.cancel') }}</button>
          </div>
        </section>
        <section
          class="voice-catalog"
          :aria-label="t('voiceCommands.catalog')"
          tabindex="0"
        >
          <h2>{{ t('voiceCommands.catalog') }}</h2>
          <p v-if="!voice.catalog.length">{{ t('voiceCommands.empty') }}</p>
          <article v-for="command in voice.catalog" :key="command.id">
            <button
              :disabled="
                voice.stage !== 'review' ||
                Boolean(voice.unavailableReason(command))
              "
              @click="voice.chooseCommand(command.id)"
            >
              {{ commandLabel(command) }}
            </button>
            <p v-if="voice.unavailableReason(command)" role="status">
              {{ t(voice.unavailableReason(command)!) }}
            </p>
            <p v-if="command.description">{{ command.description }}</p>
            <ul>
              <li v-for="phrase in phrases(command.id)" :key="phrase">
                {{ phrase }}
              </li>
            </ul>
          </article>
        </section>
      </div>
    </ActionOverlayLayout>
  </ContentPadding>
</template>

<script setup lang="ts">
import { computed, onMounted, onUnmounted, watch } from 'vue'

import ActionOverlayLayout from '../components/common/ActionOverlayLayout.vue'
import ContentPadding from '../components/common/ContentPadding.vue'
import { useI18n } from '../composables/use-i18n'
import { useOverlayNav } from '../composables/use-overlay-nav'
import { commandLabel, commandTarget } from '../lib/commands/command-runtime'
import { desktopClient } from '../lib/desktop/client'
import { useIpcStore } from '../stores/ipc'
import { useQuickDismissStore } from '../stores/quick-dismiss'
import { useVoiceCommandsStore } from '../stores/voice-commands'
import { DESKTOP_EVENTS } from '@tyco/shared'

const { t } = useI18n()
const ipc = useIpcStore()
const voice = useVoiceCommandsStore()
const releaseHold = useQuickDismissStore().hold()
const { handleEsc } = useOverlayNav(() => ({ escMode: 'close' }))
const close = () => {
  void voice.cancel()
  handleEsc()
}
const label = (id: string) => {
  const command = voice.catalog.find((item) => item.id === id)
  return command ? commandLabel(command) : id
}
const phrases = (id: string) => [
  ...new Set(
    voice.catalogRoutes
      .filter((route) => route.commandId === id)
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
const status = computed(() => {
  if (voice.stage === 'recording') return t('voiceCommands.listening')
  if (voice.stage === 'finishing') return t('voiceCommands.finishing')
  if (voice.stage === 'running')
    return t('commandLauncher.running', {
      name: voice.command ? commandLabel(voice.command) : '',
    })
  if (voice.resolution.kind === 'parameter-error')
    return t('voiceCommands.parameterError')
  if (voice.resolution.kind === 'none') return t('voiceCommands.none')
  if (voice.resolution.kind === 'incomplete')
    return t('voiceCommands.incomplete')
  return t('voiceCommands.choose')
})
watch(
  () => ipc.desktopState.isWindowShown,
  (shown) => {
    if (!shown) void voice.cancel()
  }
)
const onKeyDown = (event: KeyboardEvent) => {
  if (event.code === 'Escape' && !event.repeat) {
    event.preventDefault()
    close()
  }
}
let unlisten: (() => void) | undefined
let unmounted = false
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
    .then((stop) => {
      if (unmounted) stop()
      else unlisten = stop
    })
    .catch(() => undefined)
  void voice.start()
})
onUnmounted(() => {
  unmounted = true
  unlisten?.()
  window.removeEventListener('keydown', onKeyDown)
  releaseHold()
  void voice.cancel()
})
</script>

<style scoped>
.voice-commands {
  display: grid;
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
  gap: var(--space-md);
  height: 100%;
  min-height: 0;
}
.voice-input,
.voice-catalog {
  min-height: 0;
  overflow-y: auto;
  padding: var(--space-sm);
  overflow-wrap: anywhere;
}
.voice-input {
  display: flex;
  flex-direction: column;
  gap: var(--space-sm);
}
.voice-input label {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}
textarea {
  width: 100%;
  min-height: 5rem;
  resize: vertical;
  padding: var(--space-sm);
  background: var(--app-surface);
  border: 1px solid var(--app-text-muted);
  border-radius: var(--radius-sm);
}
.voice-controls {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-sm);
}
button {
  color: var(--color-primary);
  text-align: left;
  cursor: pointer;
}
button:disabled {
  opacity: 0.5;
  cursor: default;
}
.voice-catalog article {
  border-bottom: 1px solid var(--app-text-muted);
  padding: var(--space-sm) 0;
}
.voice-catalog h2,
.voice-catalog article > button {
  font-weight: 600;
}
.voice-catalog p,
.voice-candidate p {
  white-space: pre-wrap;
}
.voice-catalog ul {
  padding-left: 1rem;
  list-style: disc;
  font-size: var(--text-caption);
}
code {
  white-space: pre-wrap;
}
@media (max-width: 600px) {
  .voice-commands {
    grid-template-columns: 1fr;
    grid-template-rows: 1fr 1fr;
  }
}
</style>
