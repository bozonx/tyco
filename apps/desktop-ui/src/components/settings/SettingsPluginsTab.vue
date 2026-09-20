<template>
  <div>
    <template v-for="plugin of plugins" :key="plugin.pluginName">
      <h2>{{ plugin.labelKey ? t(plugin.labelKey) : plugin.label }}</h2>
      <FieldsByCfg
        :config="plugin.fields"
        @update:values="updatePluginConfig(plugin.pluginName, $event)"
      />
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/useI18n'
import { pluginIndexes } from '../../plugins'
import FieldsByCfg from '../common/FieldsByCfg.vue'

const props = defineProps<{ userConfig: Record<string, any> }>()

const emit = defineEmits<{
  (
    e: 'update:pluginConfig',
    pluginName: string,
    values: Record<string, any>
  ): void
}>()

const { t } = useI18n()

const pluginConfigs = pluginIndexes
  .map((pluginIndex) => pluginIndex())
  .filter((plugin) => plugin.defaultConfig)
  .map((plugin) => ({
    pluginName: plugin.name,
    labelKey: plugin.labelKey,
    label: plugin.label,
    fields: plugin.defaultConfig!.fields,
  }))

const plugins = computed(() => {
  return Object.keys(props.userConfig.plugins || {})
    .map((pluginName) => {
      const pluginCfg = pluginConfigs.find(
        (plugin: any) => plugin.pluginName === pluginName
      )

      if (!pluginCfg) {
        return null
      }

      const pluginValues = props.userConfig.plugins?.[pluginName] || {}

      return {
        ...pluginCfg,
        fields: pluginCfg.fields.map((field: any) => ({
          ...field,
          value: pluginValues[field.name],
        })),
      }
    })
    .filter((plugin) => plugin !== null)
})

const updatePluginConfig = (
  pluginName: string,
  values: Record<string, any>
) => {
  emit('update:pluginConfig', pluginName, values)
}
</script>
