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
          @update:values="
            operations.updatePluginConfig(plugin.pluginId, $event)
          "
        />
        <p v-else class="plugin-detail-note">
          {{ t('settings.noPluginSettings') }}
        </p>
      </div>
      <p v-else class="plugin-card-body plugin-detail-note">
        {{ t('settings.pluginDisabledHint') }}
      </p>
    </PluginCard>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import type { InstalledPluginItem } from '../../lib/plugins/plugin-settings'
import InlineNotice from '../common/InlineNotice.vue'
import ConfigFields from './ConfigFields.vue'
import PluginCard from './PluginCard.vue'
import SettingsDetailHeader from './SettingsDetailHeader.vue'

defineProps<{ plugin: InstalledPluginItem }>()

const { t } = useI18n()
const { operations, navigate } = useSettingsContext()
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
