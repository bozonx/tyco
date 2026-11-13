<template>
  <div
    class="recording-stopped"
    :class="`is-${props.kind}`"
    :role="props.kind === 'error' ? 'alert' : 'status'"
    :aria-live="props.kind === 'error' ? 'assertive' : 'polite'"
  >
    <AppIcon :icon="icon" size="md" class="recording-stopped-icon" />
    <div class="recording-stopped-copy">
      <p class="recording-stopped-message">{{ props.message }}</p>
      <p v-if="props.hint" class="recording-stopped-hint">{{ props.hint }}</p>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import AppIcon from '../common/AppIcon.vue'

/**
 * The outcome of a recording that produced no text, shown in place of the live
 * transcript: `empty` is a normal outcome (silence, noise), `error` a failed
 * session. See `dev_docs/ui-system.md`.
 */
const props = defineProps<{
  kind: 'empty' | 'error'
  message: string
  /** A likely cause and what to try next */
  hint?: string
  /** The source that heard nothing: the microphone or the computer's sound */
  source?: 'microphone' | 'system'
}>()

const icon = computed(() => {
  if (props.kind === 'error') return 'mdi:alert-circle-outline'
  return props.source === 'system' ? 'mdi:volume-off' : 'mdi:microphone-off'
})
</script>

<style scoped>
.recording-stopped {
  display: flex;
  align-items: flex-start;
  gap: var(--space-sm);
  min-width: 0;
  padding: var(--space-xs) var(--space-sm);
}

.recording-stopped-icon {
  flex-shrink: 0;
  color: var(--app-text-muted);
}

.is-error .recording-stopped-icon {
  color: var(--color-error);
}

.recording-stopped-copy {
  display: flex;
  flex-direction: column;
  gap: var(--space-2xs, 0.25rem);
  min-width: 0;
}

.recording-stopped-message {
  margin: 0;
  font-size: var(--text-control);
  line-height: 1.4;
  color: var(--color-base-content);
  overflow-wrap: anywhere;
}

.recording-stopped-hint {
  margin: 0;
  font-size: var(--text-sm, 0.875rem);
  color: var(--app-text-muted);
  overflow-wrap: anywhere;
}
</style>
