<template>
  <div
    class="segmented-control"
    :class="{ compact, 'hide-labels': hideLabelsOnSmallScreens }"
    role="radiogroup"
    :aria-label="label"
  >
    <label
      v-for="option in options"
      :key="option.id"
      class="segmented-option"
      :class="{ active: option.id === props.value }"
      :title="option.title ?? option.name"
    >
      <input
        class="sr-only"
        type="radio"
        :name="name"
        :value="option.id"
        :aria-label="option.name"
        :checked="option.id === props.value"
        @change="emit('update:value', option.id)"
      />
      <Icon v-if="option.icon" :icon="option.icon" height="15" />
      <span class="option-label">{{ option.name }}</span>
    </label>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
import { useId } from 'vue'

import { Icon } from '@iconify/vue'

const props = defineProps<{
  value: T
  label: string
  options: { id: T; name: string; icon?: string; title?: string }[]
  compact?: boolean
  hideLabelsOnSmallScreens?: boolean
}>()

const emit = defineEmits<{ (e: 'update:value', value: T): void }>()

// Radio groups need a unique name for arrow-key navigation within the group.
const name = useId()
</script>

<style scoped>
.segmented-control {
  display: inline-flex;
  flex-wrap: wrap;
  gap: 2px;
  padding: 3px;
  border-radius: var(--radius-md);
  background-color: var(--app-surface-sunken);
}

/*
 * Holds the visually hidden radio: without it, the absolutely positioned
 * input belongs to the page, and focusing it scrolls the whole page away
 */
.segmented-option {
  position: relative;
  display: inline-flex;
  align-items: center;
  gap: 0.375rem;
  padding: 0.3125rem 0.75rem;
  border-radius: calc(var(--radius-md) - 2px);
  color: var(--app-text-muted);
  font-size: 0.8125rem;
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.segmented-option:hover {
  color: var(--color-base-content);
}

.segmented-option.active {
  background-color: var(--app-surface);
  color: var(--color-base-content);
  box-shadow: var(--app-shadow-segment);
}

.segmented-option:has(:focus-visible) {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 1px;
}
.compact {
  padding: 2px;
  border: 1px solid var(--app-border-subtle);
}
.compact .segmented-option {
  padding: 0.25rem 0.5rem;
  font-size: 0.75rem;
  line-height: 1;
}
@media (max-width: 640px) {
  .hide-labels .option-label {
    display: none;
  }
  .compact.hide-labels .segmented-option {
    padding: 0.3rem 0.4rem;
  }
}
</style>
