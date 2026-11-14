<template>
  <button
    type="button"
    class="shortcut"
    :class="{
      'is-primary': variant === 'primary',
      'is-sm': size === 'sm',
      'is-xs': size === 'xs',
      'is-tile': tile,
    }"
    :disabled="disabled"
    @click="emit('click')"
  >
    <AppIcon v-if="icon" :icon="icon" size="sm" class="shortcut-icon" />
    <span class="shortcut-label">
      <slot />
    </span>
    <ShortcutKeys :keys="keys" class="shortcut-keys" />
  </button>
</template>

<script setup lang="ts">
import type { ControlSize } from '../../lib/ui/control-types'
import AppIcon from '../common/AppIcon.vue'
import ShortcutKeys from './ShortcutKeys.vue'

withDefaults(
  defineProps<{
    keys: string[]
    disabled?: boolean
    variant?: 'primary' | 'ghost'
    size?: ControlSize
    /** Decorative `mdi:*` icon before the label, for action tiles */
    icon?: string
    /** Action tile of a keyboard grid: filled, borderless, fixed height */
    tile?: boolean
  }>(),
  {
    disabled: false,
    variant: 'ghost',
    size: 'md',
    icon: undefined,
    tile: false,
  }
)

const emit = defineEmits<{ (e: 'click'): void }>()
</script>

<style scoped>
.shortcut {
  --key-size: var(--quick-kbd-size);
  --key-font-size: var(--quick-kbd-font-size);
  --key-background: var(--quick-kbd-bg);
  --key-border-color: var(--quick-kbd-border);
  --key-color: var(--quick-kbd-color);
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  width: var(--shortcut-width, 100%);
  flex: var(--shortcut-flex, initial);
  max-width: var(--shortcut-max-width, 20rem);
  min-width: 0;
  min-height: var(--control-size-sm);
  padding: var(--space-xs) var(--space-sm) var(--space-xs) var(--space-md);
  border: 1px solid var(--app-border);
  background-color: var(--app-surface);
  border-radius: var(--quick-tile-radius);
  font-size: var(--text-control);
  text-align: left;
  color: var(--color-base-content);
  cursor: pointer;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    color var(--transition-fast);
}

.shortcut:hover:not(:disabled) {
  background-color: var(--quick-tile-hover-bg);
}

.shortcut:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: 2px;
}

.shortcut:disabled {
  cursor: not-allowed;
  color: var(--app-text-faint);
  opacity: 0.6;
}

.shortcut-icon {
  flex-shrink: 0;
  color: var(--quick-tile-icon-color);
  transition: color var(--transition-fast);
}

.shortcut:hover:not(:disabled) .shortcut-icon {
  color: var(--color-primary);
}

.shortcut-label {
  flex: 1 1 0%;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  line-height: 1.25;
}

.shortcut-keys {
  margin-left: auto;
}

.shortcut.is-sm {
  max-width: none;
}

/* Action tile of a keyboard grid: filled, borderless */
.shortcut.is-tile {
  height: var(--quick-tile-height);
  padding: var(--quick-tile-padding);
  border-color: var(--quick-tile-border);
  background-color: var(--quick-tile-bg);
}

.shortcut.is-xs {
  min-height: var(--control-size-xs);
  padding: var(--space-2xs) var(--space-xs) var(--space-2xs) var(--space-sm);
  font-size: var(--text-caption);
}

/* The main action: a filled button */
.shortcut.is-primary {
  border-color: transparent;
  background-color: var(--quick-primary-bg);
  color: var(--quick-primary-fg);
  font-weight: 500;

  --key-border-color: color-mix(
    in oklab,
    var(--quick-primary-fg) 35%,
    transparent
  );
  --key-color: var(--quick-primary-fg);
}

.shortcut.is-primary:hover:not(:disabled) {
  background-color: var(--quick-primary-hover-bg);
}

.shortcut.is-primary:disabled {
  color: var(--quick-primary-fg);
}
</style>
