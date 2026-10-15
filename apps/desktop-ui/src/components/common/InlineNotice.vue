<template>
  <div
    class="inline-notice"
    :class="`inline-notice--${kind}`"
    :role="
      announcement === 'assertive'
        ? 'alert'
        : announcement === 'polite'
          ? 'status'
          : undefined
    "
  >
    <Icon
      v-if="icon"
      :icon="icon"
      height="18"
      class="shrink-0"
      aria-hidden="true"
    />
    <span class="inline-notice-message">{{ message }}</span>
    <div v-if="$slots.default" class="inline-notice-actions"><slot /></div>
  </div>
</template>
<script setup lang="ts">
import Icon from './AppIcon.vue'

withDefaults(
  defineProps<{
    message?: string
    kind?: 'info' | 'success' | 'warning' | 'error'
    announcement?: 'off' | 'polite' | 'assertive'
    icon?: string
  }>(),
  { kind: 'info', announcement: 'off' }
)
</script>
<style scoped>
.inline-notice {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
  color: var(--app-text-muted);
  font-size: var(--text-body);
}
.inline-notice-message {
  flex: 1;
  min-width: 0;
  overflow-wrap: anywhere;
}
.inline-notice-actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--space-xs);
}
.inline-notice--success {
  color: var(--color-success);
}
.inline-notice--warning {
  color: var(--color-warning);
}
.inline-notice--error {
  color: var(--color-error);
}
</style>
