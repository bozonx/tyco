<template>
  <article
    class="dialog-turn"
    :class="[
      `is-${turn.side}`,
      isBubble ? 'is-bubble' : 'is-paragraph',
      { 'is-draft': isDraft },
    ]"
    :title="hoverText"
    :aria-label="isBubble ? sideLabel : undefined"
  >
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
import InlineAction from '../common/InlineAction.vue'

const props = defineProps<{
  turn: DialogTurn
  /** Bubbles on both sides, or paragraphs when only the computer is heard */
  isBubble: boolean
  /** A translated turn shows its translation without the original */
  isTranslationOnly: boolean
  /** The language translated into; none: no translation */
  translationLang?: string
}>()

const emit = defineEmits<{
  /** Translate these segments again */
  (e: 'retry', ids: string[]): void
}>()

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
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  max-width: 100%;
}

.dialog-turn.is-bubble {
  max-width: min(80%, 42rem);
  padding: 0.5rem 0.75rem;
  border-radius: var(--radius-lg);
  background-color: var(--app-surface-raised);
  border: 1px solid var(--app-border-subtle);
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

.dialog-turn.is-draft {
  opacity: 0.75;
}

.dialog-turn-main {
  font-size: 1.0625rem;
  line-height: 1.45;
  white-space: pre-wrap;
}

.dialog-turn-text {
  line-height: 1.45;
  white-space: pre-wrap;
}

.dialog-turn-text.is-secondary {
  font-size: var(--text-small, 0.8125rem);
  color: var(--app-text-muted);
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
