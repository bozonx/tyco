<template>
  <span
    class="dialog-level"
    :class="{ 'is-off': isOff }"
    role="meter"
    :aria-label="label"
    aria-valuemin="0"
    aria-valuemax="100"
    :aria-valuenow="Math.round(shown * 100)"
    :title="label"
  >
    <AppIcon :icon="icon" size="sm" />
    <span class="dialog-level-track">
      <span class="dialog-level-fill" :style="{ width: `${shown * 100}%` }" />
    </span>
  </span>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import AppIcon from '../common/AppIcon.vue'

const props = defineProps<{
  /** The RMS level, from 0 to 1 */
  level: number
  icon: string
  label: string
  isOff?: boolean
}>()

// speech sits around -30..-10 dBFS: shown on a scale that makes it visible
const shown = computed(() =>
  props.isOff ? 0 : Math.min(1, Math.sqrt(Math.max(0, props.level)) * 2)
)
</script>

<style scoped>
.dialog-level {
  display: inline-flex;
  align-items: center;
  gap: 0.25rem;
  color: var(--app-text-muted);
}

.dialog-level.is-off {
  opacity: 0.45;
}

.dialog-level-track {
  width: 3rem;
  height: 0.375rem;
  border-radius: 999px;
  background-color: var(--app-border-subtle);
  overflow: hidden;
}

.dialog-level-fill {
  display: block;
  height: 100%;
  background-color: var(--color-success, var(--color-primary));
  transition: width 80ms linear;
}
</style>
