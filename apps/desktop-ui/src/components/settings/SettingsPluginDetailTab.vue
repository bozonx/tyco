<template>
  <div class="flex flex-col gap-4">
    <div>
      <Button size="sm" variant="ghost" class="gap-1.5" @click="emit('back')">
        <Icon icon="mdi:arrow-left" height="16" />
        {{ t('settings.backToPlugins') }}
      </Button>
    </div>

    <div
      class="surface plugin-card"
      :class="{ 'is-disabled': !plugin.isEnabled }"
      :data-plugin="plugin.pluginId"
    >
      <div class="plugin-card-header">
        <div class="plugin-icon">
          <Icon icon="mdi:puzzle-outline" height="18" />
        </div>
        <div class="flex flex-col min-w-0 flex-1">
          <h3 class="font-medium text-sm leading-tight">
            {{
              plugin.labelKey
                ? t(plugin.labelKey)
                : plugin.label || plugin.pluginId
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

        <FieldSwitch
          :key="plugin.pluginId"
          :model-value="plugin.isEnabled"
          :title="
            plugin.isEnabled
              ? t('settings.pluginEnabled')
              : t('settings.pluginDisabled')
          "
          @update:model-value="setPluginEnabled(plugin.pluginId, $event)"
        />
      </div>

      <p v-if="plugin.status" class="px-4 text-sm text-muted">
        {{ t(`settings.pluginStatus.${plugin.status}`) }}
      </p>
      <StateMessage
        v-if="plugin.error"
        kind="error"
        inline
        :message="t('settings.pluginPackageFailed', { detail: plugin.error })"
      />
      <div v-if="plugin.isEnabled" class="plugin-card-body">
        <ConfigFields
          v-if="plugin.fields.length > 0"
          :key="plugin.pluginId"
          :config="plugin.fields"
          @update:values="updatePluginConfig(plugin.pluginId, $event)"
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
import { useI18n } from '../../composables/use-i18n'
import type { InstalledPluginItem } from '../../lib/plugins/plugin-settings'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import ConfigFields from '../common/ConfigFields.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import StateMessage from '../common/StateMessage.vue'

defineProps<{ plugin: InstalledPluginItem }>()

const emit = defineEmits<{
  'update:pluginEnabled': [pluginId: string, enabled: boolean]
  'update:pluginConfig': [pluginId: string, values: Record<string, unknown>]
  back: []
}>()

const { t } = useI18n()

const setPluginEnabled = (pluginId: string, enabled: boolean) => {
  emit('update:pluginEnabled', pluginId, enabled)
}

const updatePluginConfig = (
  pluginId: string,
  values: Record<string, unknown>
) => {
  emit('update:pluginConfig', pluginId, values)
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
