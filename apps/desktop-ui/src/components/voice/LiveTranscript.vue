<template>
  <div ref="container" class="live-transcript selectable">
    <span>{{ committed }}</span>
    <span v-if="draft" class="live-transcript-draft"
      >{{ committed ? ' ' : '' }}{{ draft }}</span
    >
  </div>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = defineProps<{
  /** Settled text */
  committed: string
  /** The provider's current guess, still subject to change */
  draft?: string
}>()

const container = ref<HTMLElement>()

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

.live-transcript-draft {
  color: var(--app-text-muted);
}
</style>
