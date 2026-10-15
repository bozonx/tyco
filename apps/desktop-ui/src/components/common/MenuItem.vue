<template>
  <button
    type="button"
    role="menuitem"
    tabindex="-1"
    class="menu-item"
    :class="{ 'is-danger': danger, 'is-accent': accent, 'is-open': active }"
    :disabled="disabled"
  >
    <Icon
      v-if="icon"
      :icon="icon"
      height="16"
      class="shrink-0"
      aria-hidden="true"
    />
    <span
      v-else-if="reserveIcon"
      class="menu-item-icon-gap"
      aria-hidden="true"
    />
    <span class="menu-item-label">{{ label }}</span>
    <Icon
      v-if="hasSubmenu"
      icon="mdi:chevron-right"
      height="16"
      class="menu-item-chevron"
      aria-hidden="true"
    />
    <span v-else-if="shortcut" class="menu-item-shortcut">{{ shortcut }}</span>
  </button>
</template>
<script setup lang="ts">
import Icon from './AppIcon.vue'

defineProps<{
  label: string
  icon?: string
  disabled?: boolean
  danger?: boolean
  accent?: boolean
  active?: boolean
  reserveIcon?: boolean
  hasSubmenu?: boolean
  shortcut?: string
}>()
</script>
<style scoped>
.menu-item {
  display: flex;
  width: 100%;
  align-items: center;
  gap: var(--space-sm);
  padding: 0.375rem var(--space-sm);
  border: none;
  border-radius: var(--radius-sm);
  background: none;
  color: var(--color-base-content);
  font-size: var(--text-control);
  text-align: left;
  cursor: pointer;
  transition: background-color var(--transition-fast);
}
.menu-item:hover:not(:disabled),
.menu-item.is-open,
.menu-item:focus-visible {
  background-color: var(--app-hover);
}
.menu-item:focus-visible {
  outline: var(--app-focus-outline-width) solid var(--color-primary);
  outline-offset: -2px;
}
.menu-item:disabled {
  color: var(--app-text-faint);
  cursor: default;
}
.menu-item.is-accent {
  font-weight: 600;
}
.menu-item.is-danger {
  color: var(--color-error);
}
.menu-item.is-danger:not(:disabled):hover,
.menu-item.is-danger:focus-visible {
  background-color: var(--color-error);
  color: var(--color-error-content);
}
.menu-item-label {
  flex: 1;
  overflow: hidden;
  white-space: nowrap;
  text-overflow: ellipsis;
}
.menu-item-icon-gap {
  flex-shrink: 0;
  width: 16px;
}
.menu-item-shortcut {
  flex-shrink: 0;
  padding-left: var(--space-lg);
  font-size: var(--text-caption);
  color: var(--app-text-faint);
}
.menu-item-chevron {
  flex-shrink: 0;
  color: var(--app-text-faint);
}
</style>
