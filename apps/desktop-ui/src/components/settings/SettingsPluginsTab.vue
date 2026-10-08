<template>
  <div class="flex flex-col gap-3">
    <div v-if="installedPlugins.length === 0" class="text-sm text-muted">
      {{ t('settings.noInstalledPlugins') }}
    </div>

    <div
      v-for="plugin of installedPlugins"
      :key="plugin.name"
      class="surface plugin-card"
      :class="{ 'is-disabled': !plugin.enabled }"
      :data-plugin="plugin.name"
      role="button"
      tabindex="0"
      @click="openPluginSettings(plugin.name)"
      @keydown.enter.prevent="openPluginSettings(plugin.name)"
      @keydown.space.prevent="openPluginSettings(plugin.name)"
    >
      <div class="plugin-card-header">
        <div class="plugin-icon">
          <Icon icon="mdi:puzzle-outline" height="18" />
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <h3 class="font-medium text-sm leading-tight">
            {{
              plugin.labelKey ? t(plugin.labelKey) : plugin.label || plugin.name
            }}
          </h3>
          <p
            v-if="plugin.descriptionKey || plugin.description"
            class="text-xs text-muted mt-0.5"
          >
            {{
              plugin.descriptionKey
                ? t(plugin.descriptionKey)
                : plugin.description
            }}
          </p>
        </div>

        <div class="plugin-toggle" @click.stop>
          <FieldCheckbox
            :value="plugin.enabled"
            :title="
              plugin.enabled
                ? t('settings.pluginEnabled')
                : t('settings.pluginDisabled')
            "
            @update:value="setPluginEnabled(plugin.name, $event)"
          />
        </div>

        <Icon
          icon="mdi:chevron-right"
          height="20"
          class="plugin-chevron text-muted"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { resolveInstalledPlugins } from '../../lib/plugins/plugin-settings'
import { pluginIndexes } from '../../plugins'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{
  userConfig: { plugins?: Record<string, unknown> }
}>()

const emit = defineEmits<{
  'update:pluginEnabled': [pluginName: string, enabled: boolean]
  selectPlugin: [pluginName: string]
}>()

const { t } = useI18n()

const installedPlugins = computed(() => {
  return resolveInstalledPlugins(pluginIndexes, props.userConfig)
})

const setPluginEnabled = (pluginName: string, enabled: boolean) => {
  emit('update:pluginEnabled', pluginName, enabled)
}

const openPluginSettings = (pluginName: string) => {
  emit('selectPlugin', pluginName)
}
</script>

<style scoped>
.plugin-card {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
  cursor: pointer;
  user-select: none;
  transition:
    background-color var(--transition-fast),
    border-color var(--transition-fast),
    box-shadow var(--transition-fast);
}

.plugin-card:hover {
  background-color: var(--app-surface-raised);
  border-color: var(--app-border-strong);
}

.plugin-card:focus-visible {
  outline: none;
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

.plugin-toggle {
  display: flex;
  align-items: center;
}

.plugin-chevron {
  flex-shrink: 0;
  transition: transform var(--transition-fast);
}

.plugin-card:hover .plugin-chevron {
  transform: translateX(2px);
  color: var(--color-base-content);
}
</style>
