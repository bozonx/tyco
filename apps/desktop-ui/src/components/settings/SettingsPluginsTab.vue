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

        <FieldCheckbox
          :value="plugin.enabled"
          :label="t('settings.pluginEnabled')"
          @update:value="setPluginEnabled(plugin.name, $event)"
        />
      </div>

      <div
        v-if="plugin.enabled && plugin.fields.length > 0"
        class="plugin-card-body"
      >
        <FieldsByCfg
          :config="plugin.fields"
          @update:values="updatePluginConfig(plugin.name, $event)"
        />
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { pluginIndexes } from '../../plugins'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldsByCfg from '../common/FieldsByCfg.vue'
import { Icon } from '@iconify/vue'

const props = defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{
  'update:pluginEnabled': [pluginName: string, enabled: boolean]
  'update:pluginConfig': [pluginName: string, values: Record<string, any>]
}>()

const { t } = useI18n()

const installedPlugins = computed(() => {
  return pluginIndexes.map((pluginIndex) => {
    const plugin = pluginIndex()
    const pluginName = plugin.name
    const pluginState = props.userConfig.plugins?.[pluginName] || {}
    const isEnabled = pluginState.enabled !== false
    const rawFields = plugin.defaultConfig?.fields || []

    return {
      name: pluginName,
      labelKey: plugin.labelKey,
      label: plugin.label,
      descriptionKey: (plugin as any).descriptionKey,
      description: (plugin as any).description,
      enabled: isEnabled,
      fields: rawFields.map((field: any) => ({
        ...field,
        value: pluginState[field.name],
      })),
    }
  })
})

const setPluginEnabled = (pluginName: string, enabled: boolean) => {
  emit('update:pluginEnabled', pluginName, enabled)
}

const updatePluginConfig = (
  pluginName: string,
  values: Record<string, any>
) => {
  emit('update:pluginConfig', pluginName, values)
}
</script>

<style scoped>
.plugin-card {
  overflow: hidden;
  box-shadow: var(--app-shadow-sm);
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

.plugin-card-body {
  border-top: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}
</style>
