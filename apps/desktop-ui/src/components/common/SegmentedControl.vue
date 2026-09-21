<template>
  <div class="segmented-control" role="radiogroup" :aria-label="label">
    <label
      v-for="option in options"
      :key="option.id"
      class="segmented-option"
      :class="{ active: option.id === props.value }"
    >
      <input
        class="sr-only"
        type="radio"
        :name="name"
        :value="option.id"
        :checked="option.id === props.value"
        @change="emit('update:value', option.id)"
      />
      <Icon v-if="option.icon" :icon="option.icon" height="15" />
      <span>{{ option.name }}</span>
    </label>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
import { useId } from 'vue'

import { Icon } from '@iconify/vue'

const props = defineProps<{
  value: T
  label: string
  options: { id: T; name: string; icon?: string }[]
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

.segmented-option {
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
</style>
