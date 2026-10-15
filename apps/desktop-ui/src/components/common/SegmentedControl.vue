<template>
  <div
    v-bind="groupAttrs()"
    class="segmented-control"
    :class="{ 'hide-labels': hideLabelsOnSmallScreens }"
    :data-size="size ?? 'md'"
    role="radiogroup"
    :aria-label="label"
  >
    <label
      v-for="option in options"
      :key="option.id"
      class="segmented-option"
      :class="{ active: option.id === props.modelValue }"
      :title="option.title ?? option.name"
    >
      <input
        class="sr-only"
        type="radio"
        :disabled="controlAttrs().disabled"
        :required="controlAttrs().required"
        :name="name"
        :value="option.id"
        :aria-label="option.name"
        :checked="option.id === props.modelValue"
        @change="selectOption(option.id)"
      />
      <Icon v-if="option.icon" :icon="option.icon" height="15" />
      <span class="option-label">{{ option.name }}</span>
    </label>
  </div>
</template>

<script setup lang="ts" generic="T extends string | number">
import { useId } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import type { ControlOption } from '../../lib/ui/control-option'
import type { ControlSize } from '../../lib/ui/control-types'
import Icon from './AppIcon.vue'

defineOptions({ inheritAttrs: false })
const props = defineProps<{
  modelValue?: T
  label: string
  options: ControlOption<T>[]
  size?: ControlSize
  hideLabelsOnSmallScreens?: boolean
}>()
const controlAttrs = useFieldControl({
  register: false,
  getLabel: () => props.label,
})

const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>()

function groupAttrs() {
  const { disabled, required, ...attrs } = controlAttrs()
  return {
    ...attrs,
    'aria-disabled': disabled || undefined,
    'aria-required': required || undefined,
  }
}

function selectOption(id: T) {
  emit('update:modelValue', id)
}

// Radio groups need a unique name for arrow-key navigation within the group.
const name = useId()
</script>

<style scoped>
.segmented-control {
  display: inline-flex;
  flex-wrap: wrap;
  gap: var(--segment-gap);
  padding: var(--segment-padding);
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
  padding: var(--segment-option-padding);
  border-radius: calc(var(--radius-md) - 2px);
  color: var(--app-text-muted);
  font-size: var(--text-control);
  font-weight: 500;
  line-height: 1.25;
  cursor: pointer;
  transition:
    color var(--transition-fast),
    background-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.segmented-option:has(:disabled) {
  opacity: 0.5;
  cursor: default;
}

.segmented-option:not(:has(:disabled)):hover {
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
.segmented-control[data-size='sm'] {
  padding: 2px;
  border: 1px solid var(--app-border-subtle);
}
.segmented-control[data-size='sm'] .segmented-option {
  padding: 0.25rem 0.5rem;
  font-size: var(--text-caption);
  line-height: 1;
}
@container (max-width: 40rem) {
  .hide-labels .option-label {
    display: none;
  }
  .segmented-control[data-size='sm'].hide-labels .segmented-option {
    padding: 0.3rem 0.4rem;
  }
}
.segmented-control[data-size='xs'] .segmented-option {
  padding: 0.125rem 0.375rem;
  font-size: var(--text-caption);
}
</style>
