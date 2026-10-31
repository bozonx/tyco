<template>
  <div
    ref="container"
    class="live-transcript selectable"
    role="status"
    aria-live="polite"
    aria-atomic="false"
  >
    <Transition name="fade" mode="out-in">
      <div v-if="!hasContent && !hasPrefix" class="live-transcript-placeholder">
        <span class="placeholder-text">{{
          placeholder || t('menu.speakNow')
        }}</span>
        <span class="placeholder-cursor" aria-hidden="true" />
      </div>
      <div v-else class="live-transcript-content">
        <span v-if="prefix" class="live-transcript-prefix">{{ prefix }}</span>
        <span v-if="committed">{{ committedSpacer }}{{ committed }}</span>
        <!-- the guess is rewritten many times a second: a screen reader
             announces the words once they settle -->
        <span v-if="draft" class="live-transcript-draft" aria-hidden="true"
          >{{ draftSpacer }}{{ draft }}</span
        >
        <span v-if="!hasContent" class="placeholder-text placeholder-inline"
          >{{ placeholderSpacer }}{{ placeholder || t('menu.speakNow') }}</span
        >
        <span class="live-transcript-cursor" aria-hidden="true" />
        <span v-if="suffix" class="live-transcript-suffix"
          >{{ suffixSpacer }}{{ suffix }}</span
        >
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { needsSpaceBetween } from '../../lib/text/word-spacing'

const props = defineProps<{
  /** Settled text */
  committed: string
  /** The provider's current guess, still subject to change */
  draft?: string
  /** Optional custom placeholder text */
  placeholder?: string
  /** Text that preceded the voice dictation (e.g. earlier content in input) */
  prefix?: string
  /** Text that follows the voice dictation (e.g. content after caret) */
  suffix?: string
}>()

const { t } = useI18n()
const container = ref<HTMLElement>()

const hasContent = computed(() => Boolean(props.committed || props.draft))
const hasPrefix = computed(() => Boolean(props.prefix || props.suffix))

// the same spacing as the text that is inserted, see `insertAtCursor`
const spacer = (head: string | undefined, tail: string | undefined) =>
  needsSpaceBetween(head ?? '', tail ?? '') ? ' ' : ''

/** The placeholder stands in for words: it is set off from the prefix */
const placeholderSpacer = computed(() =>
  props.prefix && !/\s$/u.test(props.prefix) ? ' ' : ''
)

const committedSpacer = computed(() => spacer(props.prefix, props.committed))

const draftSpacer = computed(() =>
  spacer(props.committed || props.prefix, props.draft)
)

const suffixSpacer = computed(() => {
  const spoken = props.draft || props.committed
  if (spoken) return spacer(spoken, props.suffix)
  return props.suffix && !/^\s/u.test(props.suffix) ? ' ' : ''
})

// the newest words are the ones being spoken: keep them in view
watch(
  () => [props.committed, props.draft, props.prefix],
  async () => {
    await nextTick()
    const element = container.value
    if (element) element.scrollTop = element.scrollHeight
  },
  { immediate: true }
)
</script>

<style scoped>
.live-transcript {
  display: flex;
  flex-direction: column;
  flex: 1 1 0%;
  min-height: 0;
  padding: var(--space-md) var(--space-lg);
  overflow-y: auto;
  font-size: var(--text-title);
  line-height: 1.6;
  text-align: left;
  white-space: pre-wrap;
  word-break: break-word;
  color: var(--color-base-content);
}

.live-transcript-placeholder {
  display: flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--app-text-muted);
  user-select: none;
  pointer-events: none;
}

.placeholder-text {
  font-style: italic;
}

.placeholder-inline {
  color: var(--app-text-muted);
  user-select: none;
  pointer-events: none;
}

.live-transcript-prefix,
.live-transcript-suffix {
  opacity: 0.85;
}

.live-transcript-content {
  width: 100%;
}

.live-transcript-draft {
  color: var(--app-text-muted);
}

.placeholder-cursor,
.live-transcript-cursor {
  display: inline-block;
  width: 2px;
  height: 1.15em;
  margin-left: 2px;
  background-color: var(--color-primary);
  border-radius: 1px;
  vertical-align: -0.15em;
  animation: cursor-blink 1s ease-in-out infinite;
}

@keyframes cursor-blink {
  0%,
  100% {
    opacity: 1;
  }
  50% {
    opacity: 0.2;
  }
}

.fade-enter-active,
.fade-leave-active {
  transition: opacity 0.15s ease;
}

.fade-enter-from,
.fade-leave-to {
  opacity: 0;
}
@media (prefers-reduced-motion: reduce) {
  *,
  *::before,
  *::after {
    animation: none !important;
    transition: none !important;
  }
}
</style>
