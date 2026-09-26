<template>
  <div ref="container" class="live-transcript selectable">
    <Transition name="fade" mode="out-in">
      <div v-if="!hasContent" class="live-transcript-placeholder">
        <span class="placeholder-text">{{
          placeholder || t('menu.speakNow')
        }}</span>
        <span class="placeholder-cursor" aria-hidden="true" />
      </div>
      <div v-else class="live-transcript-content">
        <span>{{ committed }}</span>
        <span v-if="draft" class="live-transcript-draft"
          >{{ committed ? ' ' : '' }}{{ draft }}</span
        >
        <span class="live-transcript-cursor" aria-hidden="true" />
      </div>
    </Transition>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'

const props = defineProps<{
  /** Settled text */
  committed: string
  /** The provider's current guess, still subject to change */
  draft?: string
  /** Optional custom placeholder text */
  placeholder?: string
}>()

const { t } = useI18n()
const container = ref<HTMLElement>()

const hasContent = computed(() => Boolean(props.committed || props.draft))

// the newest words are the ones being spoken: keep them in view
watch(
  () => [props.committed, props.draft],
  async () => {
    await nextTick()
    const element = container.value
    if (element) element.scrollTop = element.scrollHeight
  }
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
  font-size: 0.9375rem;
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
</style>
