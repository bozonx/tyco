<template>
  <article
    class="dialog-turn"
    :class="[
      `is-${turn.side}`,
      isBubble ? 'is-bubble' : 'is-paragraph',
      { 'is-draft': isDraft },
    ]"
  >
    <header class="dialog-turn-meta">
      <span v-if="isBubble" class="dialog-turn-side">{{ sideLabel }}</span>
      <time class="dialog-turn-time">{{ formatDialogTime(turn.startMs) }}</time>
    </header>
    <p
      v-if="showsTranslation && translation"
      class="dialog-turn-main"
      :lang="translationLang"
    >
      {{ translation }}
    </p>
    <p
      v-if="showsOriginal || !translation"
      class="dialog-turn-text"
      :class="{ 'is-secondary': showsTranslation && translation }"
    >
      <template v-for="segment in turn.segments" :key="segment.id">
        <span :class="{ 'is-interim': !segment.isFinal }">{{
          segment.text
        }}</span>
        {{ ' ' }}
      </template>
    </p>
    <p v-if="isTranslating" class="dialog-turn-status" role="status">
      {{ t('dialog.translating') }}
    </p>
    <p v-else-if="hasFailedTranslation" class="dialog-turn-status is-error">
      {{ t('dialog.translationFailed') }}
    </p>
  </article>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { formatDialogTime } from '../../lib/dialog/dialog-export'
import {
  type DialogTurn,
  isTurnTranslating,
  turnTranslation,
} from '../../lib/dialog/dialog-transcript'
import type { DialogTextDisplay } from '@tyco/shared'

const props = defineProps<{
  turn: DialogTurn
  /** Bubbles on both sides, or paragraphs when only the computer is heard */
  isBubble: boolean
  textDisplay: DialogTextDisplay
  translationLang?: string
}>()

const { t } = useI18n()

const sideLabel = computed(() =>
  t(props.turn.side === 'me' ? 'dialog.sideMe' : 'dialog.sideRemote')
)
const translation = computed(() => turnTranslation(props.turn))
const isDraft = computed(() =>
  props.turn.segments.every((segment) => !segment.isFinal)
)
// the user's own speech is never translated
const showsTranslation = computed(
  () => props.turn.side === 'remote' && props.textDisplay !== 'original'
)
const showsOriginal = computed(
  () =>
    props.turn.side === 'me' ||
    props.textDisplay !== 'translation' ||
    !translation.value
)
const isTranslating = computed(
  () => showsTranslation.value && isTurnTranslating(props.turn)
)
const hasFailedTranslation = computed(
  () =>
    showsTranslation.value &&
    props.turn.segments.some((segment) => segment.translationState === 'failed')
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

.dialog-turn-meta {
  display: flex;
  gap: 0.5rem;
  font-size: var(--text-caption, 0.75rem);
  color: var(--app-text-faint);
}

.dialog-turn-side {
  font-weight: 600;
  color: var(--app-text-muted);
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

.is-interim {
  color: var(--app-text-faint);
  font-style: italic;
}

.dialog-turn-status {
  font-size: var(--text-caption, 0.75rem);
  color: var(--app-text-faint);
}

.dialog-turn-status.is-error {
  color: var(--color-error);
}
</style>
