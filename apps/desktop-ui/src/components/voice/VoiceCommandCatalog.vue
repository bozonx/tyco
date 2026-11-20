<template>
  <section
    ref="catalogRef"
    class="voice-catalog"
    :aria-label="t('voiceCommands.catalog')"
    @keydown="onCatalogKeyDown"
  >
    <button
      v-for="command in commands"
      :key="command.id"
      type="button"
      class="voice-entry"
      :class="{
        'is-marked': marks.has(command.id),
        'is-pickable': canPick(command),
        'is-unavailable': unavailableReason(command),
      }"
      :data-key="command.id"
      :aria-current="marks.has(command.id) || undefined"
      :aria-disabled="!canPick(command) || undefined"
      :title="entryTooltip(command)"
      @click="emit('pick', command)"
    >
      <AppIcon
        class="voice-entry-icon"
        :icon="commandIcon(command, tools)"
        size="lg"
        aria-hidden="true"
      />
      <span class="voice-entry-body">
        <span class="voice-entry-name">
          {{ primaryPhrase(command) || commandLabel(command) }}
          <Badge
            v-for="label in parameterLabels(command)"
            :key="label"
            tone="accent"
            >{{ label }}</Badge
          >
        </span>
        <span
          v-if="showSecondaryName(command)"
          class="voice-entry-phrase"
          >{{ commandLabel(command) }}</span
        >
      </span>
      <AppIcon
        v-if="unavailableReason(command)"
        class="voice-entry-warning"
        icon="mdi:alert-circle-outline"
        size="md"
        :title="t(unavailableReason(command)!)"
        :aria-label="t(unavailableReason(command)!)"
      />
    </button>
    <p v-if="!commands.length" class="voice-empty">
      {{ t('voiceCommands.empty') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { commandIcon, commandLabel } from '../../lib/commands/command-runtime'
import type { VoiceCandidate } from '../../lib/voice-commands/voice-resolver'
import {
  voiceCommandPhrases,
  voiceParameterLabels,
} from '../../lib/voice-commands/voice-view-presenter'
import { useOperationsStore } from '../../stores/operations'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import type { CommandConfig } from '@tyco/shared'

const props = defineProps<{
  commands: readonly CommandConfig[]
  marks: ReadonlyMap<string, VoiceCandidate>
  stage: string
  unavailableReason: (command: CommandConfig) => string | undefined
}>()

const emit = defineEmits<{ pick: [command: CommandConfig] }>()

const { t } = useI18n()
const tools = useOperationsStore()
const catalogRef = ref<HTMLElement | null>(null)

const primaryPhrase = (command: CommandConfig) =>
  voiceCommandPhrases(command, tools, t).slice(0, 2).join(' · ')

const showSecondaryName = (command: CommandConfig) => {
  const phrase = primaryPhrase(command)
  return Boolean(phrase && phrase !== commandLabel(command))
}

const entryTooltip = (command: CommandConfig) => {
  const phrases = voiceCommandPhrases(command, tools, t)
  const parts = [commandLabel(command)]
  if (phrases.length) parts.push(phrases.join(', '))
  if (command.description) parts.push(command.description)
  return parts.join('\n')
}

/** The values the recognizer heard for a marked command */
const parameterLabels = (command: CommandConfig) => {
  const candidate = props.marks.get(command.id)
  return candidate
    ? voiceParameterLabels(command, candidate.parameters, tools, t)
    : []
}
// rows stay focusable and keep their hints while they cannot be picked
const canPick = (command: CommandConfig) =>
  (props.stage === 'review' || props.stage === 'recording') &&
  !props.unavailableReason(command)

// the marked row may sit below the fold of a long list
watch(
  () => [...props.marks.keys()][0],
  async (key) => {
    if (!key) return
    await nextTick()
    catalogRef.value
      ?.querySelector<HTMLElement>(`[data-key="${CSS.escape(key)}"]`)
      ?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
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
</script>

<style scoped>
.voice-catalog {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(11.5rem, 1fr));
  align-content: start;
  gap: 0.375rem;
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-xs);
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
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
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


</style>
