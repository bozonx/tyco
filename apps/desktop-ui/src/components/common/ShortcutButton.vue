<template>
  <button
    type="button"
    class="shortcut"
    :class="{
      'is-primary': variant === 'primary',
      'is-sm': size === 'sm',
      'is-xs': size === 'xs',
    }"
    :disabled="disabled"
    @click="emit('click')"
  >
    <span class="shortcut-keys">
      <KeyboardKey v-for="key in keys" :key="key">{{ key }}</KeyboardKey>
    </span>
    <Icon v-if="icon" :icon="icon" height="16" class="shortcut-icon" />
    <span class="shortcut-label">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
import type { ControlSize } from '../../lib/ui/control-types'
import Icon from './AppIcon.vue'
import KeyboardKey from './KeyboardKey.vue'

withDefaults(
  defineProps<{
    keys: string[]
    icon?: string
    disabled?: boolean
    variant?: 'primary' | 'ghost'
    size?: ControlSize
  }>(),
  { icon: undefined, disabled: false, variant: 'ghost', size: 'md' }
)

const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<style scoped>
.shortcut {
  --key-size: 1.75rem;
  display: flex;
  align-items: center;
  gap: var(--space-md);
  width: var(--shortcut-width, 100%);
  flex: var(--shortcut-flex, initial);
  max-width: var(--shortcut-max-width, 20rem);
  min-width: 0;
  padding: 0.375rem 0.625rem 0.375rem 0.375rem;
  border: 1px solid transparent;
  border-radius: var(--radius-md);
  font-size: var(--text-body);
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
  cursor: not-allowed;
  color: var(--app-text-faint);
}

.shortcut.is-primary:disabled {
  border-color: var(--app-border-subtle);
  background-color: color-mix(in oklab, var(--app-surface) 60%, transparent);

  --key-border-color: var(--app-border);
  --key-color: var(--app-text-muted);
}

.shortcut-keys {
  display: inline-flex;
  gap: 0.25rem;
  flex-shrink: 0;
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

  --key-border-color: color-mix(
    in oklab,
    var(--color-primary) 60%,
    transparent
  );
  --key-color: var(--color-primary);
}

.shortcut.is-primary:hover:not(:disabled) {
  background-color: color-mix(in oklab, var(--color-primary) 22%, transparent);
  border-color: color-mix(in oklab, var(--color-primary) 55%, transparent);
}

.shortcut.is-sm {
  gap: 0.375rem;
  padding: 0.2rem 0.375rem;
  font-size: var(--text-control);
  max-width: none;

  --key-size: 1.4rem;
  --key-font-size: var(--text-caption);
}

.shortcut.is-xs {
  padding: var(--space-xs);
  font-size: var(--text-caption);

  --key-size: var(--control-size-xs);
}
</style>
