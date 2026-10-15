<template>
  <component
    :is="interactive ? 'button' : 'span'"
    :type="interactive ? 'button' : undefined"
    class="ui-badge"
    :class="[`ui-badge--${tone}`, `ui-badge--${size}`]"
  >
    <slot />
  </component>
</template>
<script setup lang="ts">
import type { ControlSize } from '../../lib/ui/control-types'

withDefaults(
  defineProps<{
    tone?: 'neutral' | 'muted' | 'accent' | 'success' | 'warning' | 'error'
    size?: ControlSize
    interactive?: boolean
  }>(),
  { tone: 'neutral', size: 'sm', interactive: false }
)
</script>
<style scoped>
.ui-badge {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs);
  flex-shrink: 0;
  padding: 0 var(--space-xs);
  border: 1px solid var(--app-border);
  border-radius: var(--radius-sm);
  font-size: var(--text-micro);
  font-weight: 500;
  line-height: 1.4;
  color: var(--app-text-muted);
}
.ui-badge--xs {
  font-size: var(--text-micro);
}
.ui-badge--md {
  padding: 0.125rem var(--space-sm);
  font-size: var(--text-caption);
}
.ui-badge--muted {
  color: var(--app-text-faint);
}
.ui-badge--accent {
  color: var(--color-primary);
  background: var(--app-accent-soft);
}
.ui-badge--success {
  color: var(--color-success);
}
.ui-badge--warning {
  color: var(--color-warning);
}
.ui-badge--error {
  color: var(--color-error);
}
button.ui-badge {
  cursor: pointer;
}
button.ui-badge:hover:not(:disabled) {
  background: var(--app-hover);
}
button.ui-badge:disabled {
  opacity: 0.5;
  cursor: default;
}
</style>
