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
    <ShortcutKeys :keys="keys" />
    <span class="shortcut-label">
      <slot />
    </span>
  </button>
</template>

<script setup lang="ts">
import type { ControlSize } from '../../lib/ui/control-types'
import ShortcutKeys from './ShortcutKeys.vue'

withDefaults(
  defineProps<{
    keys: string[]
    disabled?: boolean
    variant?: 'primary' | 'ghost'
    size?: ControlSize
  }>(),
  { disabled: false, variant: 'ghost', size: 'md' }
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
  border: 1px solid var(--app-border);
  background-color: var(--app-surface);
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

.shortcut:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 2px;
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

.shortcut-label {
  overflow: hidden;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
  line-clamp: 2;
  word-break: break-word;
  line-height: 1.15;
  flex: 1 1 0%;
  min-width: 0;
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
  gap: 0.3125rem;
  padding: 0.25rem 0.375rem;
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
