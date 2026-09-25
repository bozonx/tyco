<template>
  <button
    type="button"
    class="shortcut"
    :class="{ 'is-primary': primary, 'is-sm': sm }"
    :disabled="disabled"
    @click="emit('click')"
  >
    <span class="shortcut-keys">
      <KeyButton v-for="key in keys" :key="key">{{ key }}</KeyButton>
    </span>
    <Icon v-if="icon" :icon="icon" height="16" class="shortcut-icon" />
    <span class="shortcut-label">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
import KeyButton from './KeyButton.vue'
import { Icon } from '@iconify/vue'

withDefaults(
  defineProps<{
    keys: string[]
    icon?: string
    disabled?: boolean
    primary?: boolean
    sm?: boolean
  }>(),
  { icon: undefined, disabled: false, primary: false, sm: false }
)

const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<style scoped>
.shortcut {
  display: flex;
  align-items: center;
  gap: 0.625rem;
  width: 100%;
  min-width: 0;
  padding: 0.375rem 0.625rem 0.375rem 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: 0.875rem;
  text-align: left;
  color: var(--color-base-content);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast);
}

.shortcut:hover:not(:disabled) {
  background-color: var(--app-hover);
  border-color: var(--app-border-subtle);
}

.shortcut:disabled {
  cursor: default;
  opacity: 0.4;
}

.shortcut-keys {
  display: inline-flex;
  gap: 0.25rem;
  flex-shrink: 0;
}

.shortcut-keys :deep(.kbd) {
  min-width: 1.75rem;
  height: 1.75rem;
}

.shortcut-icon {
  flex-shrink: 0;
  color: var(--app-text-muted);
}

.shortcut-label {
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}

.shortcut.is-primary {
  border-color: color-mix(in oklab, var(--color-primary) 40%, transparent);
  background-color: color-mix(in oklab, var(--color-primary) 14%, transparent);
}

.shortcut.is-primary:hover:not(:disabled) {
  background-color: color-mix(in oklab, var(--color-primary) 22%, transparent);
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
}

.shortcut.is-primary .shortcut-keys :deep(.kbd) {
  border-color: color-mix(in oklab, var(--color-primary) 60%, transparent);
  color: var(--color-primary);
}

.shortcut.is-sm {
  gap: 0.375rem;
  padding: 0.2rem 0.375rem;
  font-size: 0.8125rem;
}

.shortcut.is-sm .shortcut-keys :deep(.kbd) {
  min-width: 1.4rem;
  height: 1.4rem;
  font-size: 0.75rem;
}
</style>
