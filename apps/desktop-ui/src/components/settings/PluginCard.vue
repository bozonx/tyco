<template>
  <div
    class="surface plugin-card"
    :class="{ 'is-disabled': !plugin.isEnabled, 'is-openable': openable }"
    :data-plugin="plugin.pluginId"
  >
    <div class="plugin-card-header">
      <div class="plugin-icon">
        <AppIcon icon="mdi:puzzle-outline" size="lg" />
      </div>
      <div class="plugin-card-copy">
        <h3 class="plugin-card-title">
          <!-- The open button stretches over the card; the actions and the
               switch sit above it, so no control is nested in another. -->
          <button
            v-if="openable"
            type="button"
            class="plugin-card-open"
            @click="emit('open')"
          >
            {{ title }}
          </button>
          <template v-else>{{ title }}</template>
        </h3>
        <slot name="meta" />
        <p v-if="description" class="plugin-card-description">
          {{ description }}
        </p>
      </div>

      <div v-if="$slots.actions" class="plugin-card-actions">
        <slot name="actions" />
      </div>
      <FieldSwitch
        :key="plugin.pluginId"
        class="plugin-card-switch"
        :model-value="plugin.isEnabled"
        :title="
          plugin.isEnabled
            ? t('settings.pluginEnabled')
            : t('settings.pluginDisabled')
        "
        @update:model-value="emit('update:enabled', $event)"
      />
      <AppIcon
        v-if="openable"
        icon="mdi:chevron-right"
        size="xl"
        class="plugin-chevron text-muted"
        aria-hidden="true"
      />
    </div>
    <slot />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { InstalledPluginItem } from '../../lib/plugins/plugin-settings'
import AppIcon from '../common/AppIcon.vue'
import FieldSwitch from '../common/FieldSwitch.vue'

const props = defineProps<{
  plugin: InstalledPluginItem
  /** The whole card opens the plugin details. */
  openable?: boolean
}>()

const emit = defineEmits<{ open: []; 'update:enabled': [enabled: boolean] }>()

const { t } = useI18n()

const title = computed(() =>
  props.plugin.labelKey
    ? t(props.plugin.labelKey)
    : props.plugin.label || props.plugin.pluginId
)
const description = computed(() =>
  props.plugin.descriptionKey
    ? t(props.plugin.descriptionKey)
    : props.plugin.description
)
</script>

<style scoped>
.plugin-card {
  position: relative;
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
}

.plugin-card.is-openable {
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.plugin-card.is-openable:hover {
  background-color: var(--app-surface-raised);
  border-color: var(--app-border-strong);
}

.plugin-card:has(.plugin-card-open:focus-visible) {
  box-shadow: var(--app-focus-ring);
}

.plugin-card-header {
  display: flex;
  align-items: center;
  gap: var(--space-md);
  padding: var(--space-md) var(--space-lg);
}

.plugin-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 2rem;
  height: 2rem;
  flex-shrink: 0;
  border-radius: var(--radius-md);
  background-color: var(--app-accent-soft);
  color: var(--color-primary);
}

.plugin-card.is-disabled .plugin-icon {
  background-color: var(--app-hover);
  color: var(--app-text-faint);
}

.plugin-card-copy {
  display: flex;
  flex: 1;
  min-width: 0;
  flex-direction: column;
}

.plugin-card-title {
  font-size: var(--text-body);
  font-weight: 500;
  line-height: 1.25;
}

.plugin-card-open {
  font: inherit;
  text-align: start;
  cursor: pointer;
}

.plugin-card-open:focus-visible {
  outline: none;
}

.plugin-card-open::after {
  content: '';
  position: absolute;
  inset: 0;
}

.plugin-card-description {
  margin-top: var(--space-2xs);
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.plugin-card-actions,
.plugin-card-switch {
  position: relative;
  z-index: 1;
}

.plugin-card-actions {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.plugin-chevron {
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}

.plugin-card.is-openable:hover .plugin-chevron {
  transform: translateX(2px);
  color: var(--color-base-content);
}
</style>
