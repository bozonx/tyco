<template>
  <section
    ref="catalogRef"
    class="voice-catalog"
    :aria-label="t('voiceCommands.catalog')"
    tabindex="-1"
    @keydown="onCatalogKeyDown"
    @scroll="onCatalogScroll"
  >
    <button
      v-for="(command, index) in commands"
      :key="command.id"
      :ref="(el) => setEntryRef(index, el)"
      type="button"
      tabindex="-1"
      class="voice-entry"
      :class="{
        'is-marked': marks.has(command.id),
        'is-pickable': canPick(command),
        'is-unavailable': unavailableReason(command),
        'is-selected': index === selectedIndex,
      }"
      :data-key="command.id"
      :aria-current="marks.has(command.id) || undefined"
      :aria-disabled="!canPick(command) || undefined"
      :title="entryTooltip(command)"
      @pointerdown="preventMouseFocus"
      @click="emit('pick', command)"
      @mouseenter="selectedIndex = index"
    >
      <div class="voice-entry-top">
        <KeyboardKey
          v-if="hasShortcut(index, pageStart, PAGE)"
          class="voice-entry-slot-key"
        >
          {{ SHORTCUT_SLOT_KEYS[index - pageStart]?.toUpperCase() }}
        </KeyboardKey>
        <span v-else class="voice-entry-slot-index">#{{ index + 1 }}</span>

        <AppIcon
          class="voice-entry-icon"
          :icon="commandIcon(command, tools)"
          size="md"
          aria-hidden="true"
        />

        <span class="voice-entry-label">{{ commandLabel(command) }}</span>

        <AppIcon
          v-if="unavailableReason(command)"
          class="voice-entry-warning"
          icon="mdi:alert-circle-outline"
          size="sm"
          :title="t(unavailableReason(command)!)"
          :aria-label="t(unavailableReason(command)!)"
        />
      </div>

      <div class="voice-entry-body">
        <div class="voice-entry-name">
          <span class="voice-entry-title">
            <template
              v-for="(part, partIndex) in firstPhrase(command)"
              :key="partIndex"
            >
              <span v-if="part.kind === 'words'">{{ part.text }}</span>
              <span v-else class="voice-entry-slot">{{ part.label }}</span>
            </template>
          </span>
          <span
            v-if="morePhraseCount(command)"
            class="voice-entry-more"
            :aria-label="t('voiceCommands.morePhrases')"
            >+{{ morePhraseCount(command) }}</span
          >
          <Badge
            v-for="label in parameterLabels(command)"
            :key="label"
            tone="accent"
            size="xs"
            >{{ label }}</Badge
          >
        </div>
      </div>
    </button>
    <p v-if="!commands.length" class="voice-empty">
      {{ t('voiceCommands.empty') }}
    </p>
  </section>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { commandIcon, commandLabel } from '../../lib/commands/command-runtime'
import {
  hasShortcut,
  shiftWindow,
  shortcutTarget,
  windowStartAtScroll,
} from '../../lib/shortcut-grid/shortcut-pages'
import { preventMouseFocus } from '../../lib/ui/focus'
import type { VoiceCandidate } from '../../lib/voice-commands/voice-resolver'
import {
  voiceCommandPhrases,
  voiceParameterLabels,
  voicePhraseParts,
} from '../../lib/voice-commands/voice-view-presenter'
import { useOperationsStore } from '../../stores/operations'
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import KeyboardKey from '../common/KeyboardKey.vue'
import {
  type CommandConfig,
  SHORTCUT_SLOT_KEYS,
  type ShortcutSlotKey,
} from '@tyco/shared'

const COLUMNS = 5
const ROWS = 3
const PAGE = COLUMNS * ROWS

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
const pageStart = ref(0)
const selectedIndex = ref(0)
const entryRefs = ref<Record<number, HTMLElement | null>>({})

const setEntryRef = (index: number, el: unknown) => {
  if (el) entryRefs.value[index] = el as HTMLElement
  else delete entryRefs.value[index]
}

const gridWindow = computed(() => ({
  columns: COLUMNS,
  size: PAGE,
  count: props.commands.length,
}))

function onCatalogScroll() {
  const grid = catalogRef.value
  const first = entryRefs.value[0]
  const nextRow = entryRefs.value[COLUMNS]
  if (!grid || !first) return
  const rowHeight = nextRow
    ? nextRow.offsetTop - first.offsetTop
    : first.offsetHeight
  const start = windowStartAtScroll(grid.scrollTop, rowHeight, gridWindow.value)
  if (start !== pageStart.value) {
    pageStart.value = start
  }
}

/** What is said is shown first: the name only labels the card */
const phraseParts = computed(
  () =>
    new Map(
      props.commands.map((command) => [
        command.id,
        voicePhraseParts(command, tools, t),
      ])
    )
)
const firstPhrase = (command: CommandConfig) =>
  phraseParts.value.get(command.id)?.[0]
const morePhraseCount = (command: CommandConfig) =>
  Math.max(0, (phraseParts.value.get(command.id)?.length ?? 0) - 1)

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

function isPlainKey(event: KeyboardEvent): boolean {
  return !event.ctrlKey && !event.altKey && !event.metaKey
}

function slotOf(event: KeyboardEvent): number {
  const codeLetter =
    event.code.length === 4 && event.code.startsWith('Key')
      ? event.code.slice(3).toLowerCase()
      : undefined
  const letter = (codeLetter || event.key.toLowerCase()) as ShortcutSlotKey
  return SHORTCUT_SLOT_KEYS.indexOf(letter)
}

function pickBySlot(event: KeyboardEvent): boolean {
  if (!isPlainKey(event)) return false
  const target = shortcutTarget(
    slotOf(event),
    pageStart.value,
    props.commands.length
  )
  if (target === undefined) return false
  const command = props.commands[target]
  if (!command || !canPick(command)) return false
  emit('pick', command)
  return true
}

const onCatalogKeyDown = (event: KeyboardEvent) => {
  if (event.isComposing) return
  const count = props.commands.length
  if (count === 0) return

  const rows = [
    ...(catalogRef.value?.querySelectorAll<HTMLButtonElement>('.voice-entry') ??
      []),
  ]
  const index = rows.indexOf(document.activeElement as HTMLButtonElement)

  const moves: Record<string, () => number | undefined> = {
    ArrowRight: () => (index + 1 < count ? index + 1 : undefined),
    ArrowLeft: () => (index > 0 ? index - 1 : undefined),
    ArrowDown: () =>
      index + COLUMNS < count
        ? index + COLUMNS
        : index < count - 1
          ? count - 1
          : undefined,
    ArrowUp: () => (index >= COLUMNS ? index - COLUMNS : undefined),
    PageDown: () => {
      const next = shiftWindow(pageStart.value, 1, gridWindow.value)
      pageStart.value = next
      entryRefs.value[next]?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
      return next
    },
    PageUp: () => {
      const prev = shiftWindow(pageStart.value, -1, gridWindow.value)
      pageStart.value = prev
      entryRefs.value[prev]?.scrollIntoView({
        block: 'start',
        behavior: 'smooth',
      })
      return prev
    },
    Home: () => 0,
    End: () => count - 1,
  }

  const move = moves[event.key]
  if (move) {
    event.preventDefault()
    const target = move()
    if (target !== undefined) {
      selectedIndex.value = target
      rows[target]?.focus()
      rows[target]?.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    }
    return
  }

  if (pickBySlot(event)) {
    event.preventDefault()
  }
}

defineExpose({ pickBySlot, pageStart })
</script>

<style scoped>
.voice-catalog {
  display: grid;
  grid-template-columns: repeat(5, minmax(0, 1fr));
  grid-auto-rows: minmax(4.5rem, auto);
  align-content: start;
  gap: var(--space-xs);
  min-height: 0;
  overflow-y: auto;
  overscroll-behavior: contain;
  padding: var(--space-xs);
  outline: none;
}

.voice-entry {
  display: flex;
  flex-direction: column;
  align-items: stretch;
  gap: 0.25rem;
  width: 100%;
  padding: 0.375rem var(--space-xs);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background: var(--quick-tile-bg, transparent);
  color: var(--color-base-content);
  text-align: left;
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.voice-entry.is-pickable:hover,
.voice-entry.is-selected {
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

.voice-entry-top {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  min-width: 0;
}

.voice-entry-slot-key {
  --key-size: 1.125rem;
  --key-font-size: var(--text-nano);
  flex-shrink: 0;
}

.voice-entry-slot-index {
  font-family: var(--font-mono);
  font-size: var(--text-nano);
  color: var(--app-text-faint);
  min-width: 1.125rem;
}

.voice-entry-icon {
  flex-shrink: 0;
  color: var(--app-text-muted);
}

.voice-entry.is-marked .voice-entry-icon {
  color: var(--color-primary);
}

.voice-entry-label {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-nano);
  color: var(--app-text-muted);
}

.voice-entry-warning {
  margin-left: auto;
  flex-shrink: 0;
  color: var(--color-warning);
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
  flex-wrap: nowrap;
  min-width: 0;
  gap: 0.25rem;
  font-size: var(--text-body);
  font-weight: 500;
  line-height: 1.3;
}

.voice-entry-title {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.voice-entry-title > span + span {
  margin-left: 0.25em;
}

.voice-entry-slot {
  padding: 0 0.25rem;
  border-radius: var(--radius-sm);
  background-color: color-mix(in oklab, var(--color-primary) 15%, transparent);
  color: var(--color-primary);
}

.voice-entry-more {
  flex-shrink: 0;
  font-size: var(--text-nano);
  color: var(--app-text-muted);
}

.voice-empty {
  grid-column: 1 / -1;
  margin: 0;
  padding: var(--space-xs) var(--space-sm);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

@container (max-width: 680px) {
  .voice-catalog {
    grid-template-columns: repeat(3, minmax(0, 1fr));
  }
}

@container (max-width: 480px) {
  .voice-catalog {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
