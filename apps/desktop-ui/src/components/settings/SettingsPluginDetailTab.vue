<template>
  <div class="flex flex-col gap-4">
    <div>
      <Button sm ghost class="gap-1.5" @click="emit('back')">
        <Icon icon="mdi:arrow-left" height="16" />
        {{ t('settings.backToPlugins') }}
      </Button>
    </div>

    <div
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
          :title="
            plugin.enabled
              ? t('settings.pluginEnabled')
              : t('settings.pluginDisabled')
          "
          @update:value="setPluginEnabled(plugin.name, $event)"
        />
      </div>

      <p v-if="plugin.status" class="px-4 text-sm text-muted">
        {{ t(`settings.pluginStatus.${plugin.status}`) }}
      </p>
      <p v-if="plugin.error" class="px-4 text-sm text-error">
        {{ t('settings.pluginPackageFailed', { detail: plugin.error }) }}
      </p>
      <div v-if="plugin.enabled" class="plugin-card-body">
        <FieldsByCfg
          v-if="plugin.fields.length > 0"
          :config="plugin.fields"
          @update:values="updatePluginConfig(plugin.name, $event)"
        />
        <div v-else class="p-4 text-sm text-muted">
          {{ t('settings.noPluginSettings') }}
        </div>
      </div>

      <div v-else class="p-4 text-sm text-muted border-t border-subtle">
        {{ t('settings.pluginDisabledHint') }}
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import type { InstalledPluginItem } from '../../lib/plugins/plugin-settings'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldsByCfg from '../common/FieldsByCfg.vue'
import { Icon } from '@iconify/vue'

defineProps<{ plugin: InstalledPluginItem }>()

const emit = defineEmits<{
  'update:pluginEnabled': [pluginName: string, enabled: boolean]
  'update:pluginConfig': [pluginName: string, values: Record<string, unknown>]
  back: []
}>()

const { t } = useI18n()

const setPluginEnabled = (pluginName: string, enabled: boolean) => {
  emit('update:pluginEnabled', pluginName, enabled)
}

const updatePluginConfig = (
  pluginName: string,
  values: Record<string, unknown>
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

.border-subtle {
  border-color: var(--app-border-subtle);
}
</style>
