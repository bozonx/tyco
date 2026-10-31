<template>
  <div class="settings-stack">
    <SettingsDetailHeader
      :back-label="t('settings.backToPlugins')"
      @back="navigate('plugins')"
    />

    <PluginCard
      :plugin="plugin"
      @update:enabled="operations.updatePluginEnabled(plugin.pluginId, $event)"
    >
      <p v-if="plugin.status" class="plugin-detail-note">
        {{ t(`settings.pluginStatus.${plugin.status}`) }}
      </p>
      <InlineNotice
        v-if="plugin.error"
        kind="error"
        announcement="assertive"
        :message="t('settings.pluginPackageFailed', { detail: plugin.error })"
      />
      <div v-if="plugin.isEnabled" class="plugin-card-body">
        <ConfigFields
          v-if="plugin.fields.length > 0"
          :key="plugin.pluginId"
          :config="plugin.fields"
          :directory-field="plugin.directoryFieldName"
          @update:values="
            operations.updatePluginConfig(plugin.pluginId, $event)
          "
        />
        <p v-else class="plugin-detail-note">
          {{ t('settings.noPluginSettings') }}
        </p>
        <ToolConfigPreview
          v-for="tool in previewTools"
          :key="tool.id"
          :tool="tool"
          :config="settings"
        />
      </div>
      <p v-else class="plugin-card-body plugin-detail-note">
        {{ t('settings.pluginDisabledHint') }}
      </p>
    </PluginCard>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import type { InstalledPluginItem } from '../../lib/plugins/plugin-settings'
import { useToolsStore } from '../../stores/tools'
import InlineNotice from '../common/InlineNotice.vue'
import ConfigFields from './ConfigFields.vue'
import PluginCard from './PluginCard.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'
import ToolConfigPreview from './ToolConfigPreview.vue'

const props = defineProps<{ plugin: InstalledPluginItem }>()

const { t } = useI18n()
const { operations, navigate } = useSettingsContext()
const toolsStore = useToolsStore()
/** The settings being edited, as the plugin tools get them */
const settings = computed(() =>
  Object.fromEntries(
    props.plugin.fields.map((field) => [
      field.name,
      field.value ?? field.defaultValue,
    ])
  )
)
/** Tools of the plugin that preview their output for these settings */
const previewTools = computed(() =>
  toolsStore
    .list()
    .filter(
      (tool) =>
        tool.owner.kind === 'plugin' &&
        tool.owner.pluginId === props.plugin.pluginId &&
        tool.previewConfig
    )
)
</script>

<style scoped>
.plugin-card-body {
  border-top: 1px solid var(--app-border-subtle);
  background-color: var(--app-surface-raised);
}

.plugin-detail-note {
  padding: var(--space-lg);
  font-size: var(--text-body);
  color: var(--app-text-muted);
}
</style>
