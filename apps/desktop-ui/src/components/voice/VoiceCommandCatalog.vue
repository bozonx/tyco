<template>
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
        @click="emit('pick', entry)"
      >
        <AppIcon
          class="voice-entry-icon"
          :icon="commandIcon(entry.commands[0]!, tools)"
          size="lg"
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
        <AppIcon
          v-if="unavailable(entry)"
          class="voice-entry-warning"
          icon="mdi:alert-circle-outline"
          size="md"
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
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { commandIcon } from '../../lib/commands/command-runtime'
import type { VoiceCatalogEntry } from '../../lib/voice-commands/voice-catalog'
import type { VoiceCandidate } from '../../lib/voice-commands/voice-resolver'
import {
  type VoiceRouteLike,
  voiceEntryLabel,
  voiceEntryLanguage,
  voiceEntryPhrases,
} from '../../lib/voice-commands/voice-view-presenter'
import { useToolsStore } from '../../stores/tools'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import type { CommandConfig } from '@tyco/shared'

const props = defineProps<{
  entries: VoiceCatalogEntry[]
  marks: ReadonlyMap<string, VoiceCandidate>
  routes: readonly VoiceRouteLike[]
  stage: string
  unavailableReason: (command: CommandConfig) => string | undefined
}>()

const emit = defineEmits<{ pick: [entry: VoiceCatalogEntry] }>()

const { t } = useI18n()
const tools = useToolsStore()
const catalogRef = ref<HTMLElement | null>(null)

const groups = computed(() => [
  {
    id: 'builtIn',
    label: t('voiceCommands.builtInCatalog'),
    entries: props.entries.filter((entry) => entry.group === 'builtIn'),
  },
  {
    id: 'custom',
    label: t('voiceCommands.customCatalog'),
    entries: props.entries.filter((entry) => entry.group === 'custom'),
  },
])

const entryLabel = (entry: VoiceCatalogEntry) => voiceEntryLabel(entry, t)
const entryLanguage = (entry: VoiceCatalogEntry) =>
  voiceEntryLanguage(entry, props.marks, t)
const entryPhrases = (entry: VoiceCatalogEntry) =>
  voiceEntryPhrases(entry, props.routes, t)
const unavailable = (entry: VoiceCatalogEntry) =>
  props.unavailableReason(entry.commands[0]!)
// rows stay focusable and keep their hints while they cannot be picked
const canPick = (entry: VoiceCatalogEntry) =>
  props.stage === 'review' && !unavailable(entry)

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

@container (max-width: 600px) {
  .voice-catalog {
    border-left: none;
    border-top: 1px solid var(--app-border-subtle);
  }
}
</style>
