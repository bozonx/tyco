<template>
  <div class="flex flex-col gap-4">
    <div v-if="installedPlugins.length === 0" class="text-sm text-muted">
      {{ t('settings.noInstalledPlugins') }}
    </div>

    <div
      v-for="plugin of installedPlugins"
      :key="plugin.name"
      class="p-4 rounded-lg border border-base-300 bg-base-100 flex flex-col gap-3"
      :data-plugin="plugin.name"
    >
      <div class="flex items-center justify-between gap-3">
        <div class="flex flex-col">
          <h3 class="font-semibold text-base leading-tight">
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
        class="border-t border-base-200 pt-3 flex flex-col gap-2"
      >
        <span class="text-xs font-semibold text-muted uppercase tracking-wider">
          {{ t('settings.pluginSettings') }}
        </span>
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
