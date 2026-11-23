<template>
  <section class="tool-source" :class="{ 'is-off': off }">
    <header class="tool-source-header">
      <AppIcon
        :icon="icon"
        size="md"
        class="tool-source-icon"
        aria-hidden="true"
      />
      <h4 class="tool-source-title">{{ title }}</h4>
      <InfoTooltip v-if="info" :text="info" />
      <div v-if="$slots.actions" class="tool-source-actions">
        <slot name="actions" />
      </div>
    </header>
    <div v-if="$slots.default" class="tool-source-tools" role="list">
      <slot />
    </div>
  </section>
</template>

<script setup lang="ts">
import AppIcon from '../common/AppIcon.vue'
import InfoTooltip from '../common/InfoTooltip.vue'

/**
 * A tool source with its tools as rows (`SettingsToolRow`): the same card in
 * the catalog, a profile and the picker of an AI command
 */
defineProps<{
  icon: string
  title: string
  info?: string
  /** The source is switched off: its tools are dimmed */
  off?: boolean
}>()
</script>

<style scoped>
.tool-source {
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
}

.tool-source-header {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-height: var(--control-size-md);
  padding: var(--space-xs) var(--space-md);
}

.tool-source-icon {
  flex-shrink: 0;
  color: var(--color-secondary);
}

.tool-source-title {
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-body);
  font-weight: 500;
  color: var(--app-text);
}

.tool-source-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  margin-inline-start: auto;
  flex-shrink: 0;
}

.tool-source-tools {
  border-top: 1px solid var(--app-border-subtle);
}

.tool-source.is-off .tool-source-tools {
  opacity: 0.55;
}
</style>
