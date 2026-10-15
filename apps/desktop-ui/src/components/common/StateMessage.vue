<template>
  <div
    class="ui-state"
    :class="[
      `ui-state--${kind}`,
      {
        'ui-state--inline': inline,
        'ui-state--compact': density === 'compact',
      },
    ]"
    :role="
      kind === 'error' ? 'alert' : kind === 'loading' ? 'status' : undefined
    "
    :aria-busy="kind === 'loading' || undefined"
  >
    <span
      v-if="kind === 'loading'"
      class="loading loading-spinner text-primary"
      aria-hidden="true"
    />
    <Icon
      v-else-if="icon"
      :icon="icon"
      :height="inline ? 18 : 28"
      class="ui-state-icon"
      :aria-hidden="true"
    />
    <div class="ui-state-copy">
      <p v-if="title" class="ui-state-title">{{ title }}</p>
      <p v-if="message" class="ui-state-message">{{ message }}</p>
    </div>
    <div v-if="$slots.default" class="ui-state-actions"><slot /></div>
  </div>
</template>

<script setup lang="ts">
import Icon from './AppIcon.vue'

withDefaults(
  defineProps<{
    kind?: 'empty' | 'loading' | 'error' | 'info'
    title?: string
    message?: string
    icon?: string
    inline?: boolean
    density?: 'default' | 'compact'
  }>(),
  { kind: 'empty' }
)
</script>

<style scoped>
.ui-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-sm);
  padding: var(--space-3xl) var(--space-lg);
  text-align: center;
}
.ui-state-copy {
  min-width: 0;
}
.ui-state-icon,
.ui-state-message {
  color: var(--app-text-muted);
}
.ui-state-title {
  margin: 0;
  font-size: var(--text-body);
  font-weight: 500;
}
.ui-state-message {
  margin: 0;
  font-size: var(--text-body);
  overflow-wrap: anywhere;
}
.ui-state--error .ui-state-icon {
  color: var(--color-error);
}
.ui-state--inline {
  flex-direction: row;
  justify-content: flex-start;
  padding: var(--space-sm) var(--space-md);
  text-align: start;
}
.ui-state-actions {
  display: flex;
  gap: var(--space-sm);
}
.ui-state--inline .ui-state-actions {
  margin-inline-start: auto;
}
.ui-state--compact {
  padding: var(--space-lg) var(--space-sm);
}
</style>
