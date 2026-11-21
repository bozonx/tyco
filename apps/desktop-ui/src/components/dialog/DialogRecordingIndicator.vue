<template>
  <span class="dialog-recording" role="status" :title="label">
    <span class="dialog-recording-dot" aria-hidden="true" />
    <span class="sr-only">{{ label }}</span>
    <span class="dialog-recording-time">{{ elapsed }}</span>
  </span>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, ref } from 'vue'

import { formatRecordingElapsed } from '../../lib/dialog/dialog-recording'

/** A red dot and how long the recording runs */
const props = defineProps<{
  /** Unix time in milliseconds */
  startedAtMs: number
  label: string
}>()

const now = ref(Date.now())
const timer = setInterval(() => {
  now.value = Date.now()
}, 1000)
onBeforeUnmount(() => clearInterval(timer))

const elapsed = computed(() =>
  formatRecordingElapsed(now.value - props.startedAtMs)
)
</script>

<style scoped>
.dialog-recording {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  color: var(--app-text-muted);
  font-variant-numeric: tabular-nums;
  font-size: var(--text-caption);
}

.dialog-recording-dot {
  width: 0.5rem;
  height: 0.5rem;
  border-radius: 50%;
  background: var(--color-error);
  animation: dialog-recording-pulse 1.6s ease-in-out infinite;
}

@keyframes dialog-recording-pulse {
  50% {
    opacity: 0.35;
  }
}

@media (prefers-reduced-motion: reduce) {
  .dialog-recording-dot {
    animation: none;
  }
}
</style>
