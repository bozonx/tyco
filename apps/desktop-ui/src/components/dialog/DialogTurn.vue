<template>
  <article
    class="dialog-turn"
    :class="[
      `is-${turn.side}`,
      isBubble ? 'is-bubble' : 'is-paragraph',
      {
        'is-draft': isDraft,
        'is-selected': isSelected,
        'is-excluded': isExcluded,
        'is-use-translation': useTranslation,
      },
    ]"
    :title="hoverText"
    :aria-label="isBubble ? sideLabel : undefined"
    @click="onClick"
    @contextmenu.prevent="emit('contextmenu', $event)"
  >
    <div
      v-if="isSelectionMode"
      class="dialog-turn-checkbox"
      :class="{ 'is-checked': isSelected && !isExcluded }"
      role="checkbox"
      :aria-checked="isSelected && !isExcluded"
      :title="t(isSelected ? 'dialog.deselectTurn' : 'dialog.selectTurn')"
      @click.stop="emit('toggle-single')"
    >
      <AppIcon
        :icon="
          isSelected && !isExcluded
            ? 'mdi:checkbox-marked'
            : 'mdi:checkbox-blank-outline'
        "
        size="xs"
      />
    </div>
    <p
      v-if="showsTranslation && hasTranslation"
      class="dialog-turn-main"
      :lang="translationLang"
    >
      <template v-for="part in translatedParts" :key="part.id">
        <span
          :class="{ 'is-untranslated': part.isOriginal }"
          :lang="part.isOriginal ? undefined : translationLang"
          :aria-hidden="part.isOriginal ? 'true' : undefined"
          >{{ part.text }}</span
        >{{ ' ' }}
      </template>
    </p>
    <p
      v-if="showsOriginal"
      class="dialog-turn-text"
      :class="{ 'is-secondary': showsTranslation && hasTranslation }"
    >
      <template v-for="segment in turn.segments" :key="segment.id">
        <span
          :class="{ 'is-interim': !segment.isFinal }"
          :aria-hidden="segment.isFinal ? undefined : 'true'"
          >{{ segment.text }}</span
        >{{ ' ' }}
      </template>
    </p>
    <p v-if="hasFailedTranslation" class="dialog-turn-status is-error">
      {{ t('dialog.translationFailed') }}
      <InlineAction @click="emit('retry', failedIds)">{{
        t('dialog.retryTranslation')
      }}</InlineAction>
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { formatDialogClock } from '../../lib/dialog/dialog-export'
import type { DialogTurn } from '../../lib/dialog/dialog-transcript'
import AppIcon from '../common/AppIcon.vue'
import InlineAction from '../common/InlineAction.vue'

const props = defineProps<{
  turn: DialogTurn
  /** Bubbles on both sides, or paragraphs when only the computer is heard */
  isBubble: boolean
  /** A translated turn shows its translation without the original */
  isTranslationOnly: boolean
  /** The language translated into; none: no translation */
  translationLang?: string
  /** Whether this turn is in the active selection */
  isSelected?: boolean
  /** Whether selection mode is currently active (at least one turn selected) */
  isSelectionMode?: boolean
  /**
   * Whether this turn is selected but excluded by filters (e.g. Include Me is
   * false)
   */
  isExcluded?: boolean
  /** Whether selection prefers translation over original */
  useTranslation?: boolean
}>()

const emit = defineEmits<{
  /** Translate these segments again */
  (e: 'retry', ids: string[]): void
  /** Shift+click on this turn */
  (e: 'select', event: MouseEvent): void
  /** Toggle single turn selection (Ctrl/Cmd click or checkbox click) */
  (e: 'toggle-single'): void
  /** Right-click context menu */
  (e: 'contextmenu', event: MouseEvent): void
}>()

function onClick(event: MouseEvent) {
  if (event.ctrlKey || event.metaKey) {
    event.preventDefault()
    emit('toggle-single')
  } else if (event.shiftKey) {
    event.preventDefault()
    emit('select', event)
  }
}

const { t } = useI18n()

const sideLabel = computed(() =>
  t(props.turn.side === 'me' ? 'dialog.sideMe' : 'dialog.sideRemote')
)
// the feed shows who spoke by the side; the hover adds when
const hoverText = computed(() =>
  props.isBubble
    ? `${sideLabel.value} · ${formatDialogClock(props.turn.startMs)}`
    : formatDialogClock(props.turn.startMs)
)
const isDraft = computed(() =>
  props.turn.segments.every((segment) => !segment.isFinal)
)
// the user's own speech is never translated
const showsTranslation = computed(
  () => props.turn.side === 'remote' && Boolean(props.translationLang)
)
const hasTranslation = computed(() =>
  props.turn.segments.some((segment) => segment.translationState === 'complete')
)
/**
 * The translation so far. With the translation alone, what is not translated
 * yet follows it dimmed, so the latest words are not hidden while they wait.
 */
const translatedParts = computed(() =>
  props.turn.segments.flatMap((segment) => {
    if (segment.translationState === 'complete')
      return segment.translation
        ? [{ id: segment.id, text: segment.translation, isOriginal: false }]
        : []
    if (!props.isTranslationOnly) return []
    return [{ id: segment.id, text: segment.text, isOriginal: true }]
  })
)
const showsOriginal = computed(
  () =>
    !showsTranslation.value || !props.isTranslationOnly || !hasTranslation.value
)
const failedIds = computed(() =>
  props.turn.segments
    .filter((segment) => segment.translationState === 'failed')
    .map((segment) => segment.id)
)
const hasFailedTranslation = computed(
  () => showsTranslation.value && failedIds.value.length > 0
)
</script>

<style scoped>
.dialog-turn {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 100%;
}

.dialog-turn-checkbox {
  position: absolute;
  top: 0.375rem;
  color: var(--app-text-muted);
  cursor: pointer;
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 2;
  padding: 0.125rem;
  border-radius: var(--radius-sm);
  transition: color 150ms ease;
}

.dialog-turn.is-bubble.is-remote .dialog-turn-checkbox {
  left: -1.5rem;
}

.dialog-turn.is-bubble.is-me .dialog-turn-checkbox {
  right: -1.5rem;
}

.dialog-turn.is-paragraph .dialog-turn-checkbox {
  left: -1.5rem;
}

.dialog-turn-checkbox:hover,
.dialog-turn-checkbox.is-checked {
  color: var(--color-primary);
}

.dialog-turn.is-bubble {
  max-width: min(80%, 42rem);
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-lg);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    opacity 150ms ease;
}

.dialog-turn.is-bubble.is-selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
  background-color: color-mix(
    in oklab,
    var(--color-primary) 8%,
    var(--app-surface-raised)
  );
}

.dialog-turn.is-bubble.is-selected.is-excluded {
  border-style: dashed;
  border-color: var(--app-border-subtle);
  box-shadow: none;
  opacity: 0.55;
  background-color: var(--app-surface-raised);
}

.dialog-turn.is-paragraph {
  padding: 0.25rem 0.5rem;
  border-radius: var(--radius-md);
  border: 1px solid transparent;
  transition:
    border-color 150ms ease,
    box-shadow 150ms ease,
    opacity 150ms ease;
}

.dialog-turn.is-paragraph.is-selected {
  border-color: var(--color-primary);
  box-shadow: 0 0 0 1px var(--color-primary);
  background-color: color-mix(in oklab, var(--color-primary) 8%, transparent);
}

.dialog-turn.is-paragraph.is-selected.is-excluded {
  border-style: dashed;
  border-color: var(--app-border-subtle);
  box-shadow: none;
  opacity: 0.55;
  background-color: transparent;
}

.dialog-turn.is-bubble.is-remote {
  align-self: flex-start;
  border-bottom-left-radius: var(--radius-sm);
}

.dialog-turn.is-bubble.is-me {
  align-self: flex-end;
  border-bottom-right-radius: var(--radius-sm);
  background-color: color-mix(
    in oklab,
    var(--color-primary) 12%,
    var(--app-surface)
  );
}

.dialog-turn.is-bubble.is-me.is-selected.is-excluded {
  background-color: color-mix(
    in oklab,
    var(--app-border-subtle) 12%,
    var(--app-surface)
  );
}

.dialog-turn.is-draft {
  opacity: 0.75;
}

.dialog-turn-main {
  font-size: 1.0625rem;
  line-height: 1.45;
  white-space: pre-wrap;
  transition: opacity 150ms ease;
}

.dialog-turn-text {
  line-height: 1.45;
  white-space: pre-wrap;
  transition: opacity 150ms ease;
}

.dialog-turn-text.is-secondary {
  font-size: var(--text-small, 0.8125rem);
  color: var(--app-text-muted);
}

/* When selected, highlight the text part being exported and dim the other */
.dialog-turn.is-selected.is-use-translation .dialog-turn-text.is-secondary {
  opacity: 0.45;
}

.dialog-turn.is-selected:not(.is-use-translation) .dialog-turn-main {
  opacity: 0.55;
}

.is-interim,
.is-untranslated {
  color: var(--app-text-faint);
}

.is-interim {
  font-style: italic;
}

.dialog-turn-status {
  display: flex;
  align-items: baseline;
  gap: 0.5rem;
  font-size: var(--text-caption, 0.75rem);
  color: var(--app-text-faint);
}

.dialog-turn-status.is-error {
  color: var(--color-error);
}
</style>
