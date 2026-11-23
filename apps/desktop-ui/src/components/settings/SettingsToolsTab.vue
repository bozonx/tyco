<template>
  <div class="settings-stack">
    <SettingsSection
      v-for="(group, index) in groups"
      :key="group.id"
      :title="group.title"
      :info="index === 0 ? t('toolPermissions.catalogHint') : undefined"
    >
      <div class="settings-section-content">
        <SettingsToolSource
          v-for="entry in group.sources"
          :key="sourceKey(entry.source)"
          :icon="entry.icon"
          :title="sourceLabel(entry)"
          :info="sourceInfo(entry)"
          :off="!isSourceOn(entry)"
        >
          <template #actions>
            <Badge v-if="entry.isThirdParty" tone="warning">
              {{ t('toolPermissions.sourceThirdPartyPlugin') }}
            </Badge>
            <FieldSwitch
              :aria-label="sourceLabel(entry)"
              :model-value="isSourceOn(entry)"
              @update:model-value="setSourceOn(entry, $event)"
            />
          </template>
          <SettingsToolRow
            v-for="tool in entry.tools"
            :key="tool.name"
            :name="tool.name"
            :label="toolLabel(tool)"
            :risk="tool.risk"
          >
            <Badge v-if="defaultToolPolicy(tool) === 'ask'" tone="muted">
              {{ t('toolPermissions.asksByDefault') }}
            </Badge>
            <FieldSwitch
              :aria-label="toolLabel(tool)"
              :disabled="!isSourceOn(entry)"
              :model-value="isToolAvailable(catalog, tool)"
              @update:model-value="setToolOn(tool, $event)"
            />
          </SettingsToolRow>
        </SettingsToolSource>
      </div>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePluginToolSources } from '../../composables/use-plugin-tool-sources'
import { useSettingsContext } from '../../composables/use-settings-context'
import {
  defaultToolPolicy,
  isSourceAvailable,
  isToolAvailable,
  sourceKey,
  withSourceAvailable,
  withToolAvailable,
} from '../../lib/chat-tools/tool-catalog'
import {
  CORE_CATALOG,
  type CatalogSourceEntry,
  type CatalogToolEntry,
} from '../../lib/chat-tools/tool-catalog-entries'
import Badge from '../common/Badge.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsToolRow from './SettingsToolRow.vue'
import SettingsToolSource from './SettingsToolSource.vue'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()
const pluginSources = usePluginToolSources()

const catalog = computed(() => userConfig.value.tools)

/** The sources by where they come from; a group with nothing is left out */
const groups = computed(() =>
  [
    {
      id: 'core',
      title: t('toolPermissions.groupBuiltin'),
      sources: CORE_CATALOG,
    },
    {
      id: 'plugin',
      title: t('toolPermissions.groupPlugins'),
      sources: pluginSources.value,
    },
  ].filter((group) => group.sources.length > 0)
)

const sourceLabel = (entry: CatalogSourceEntry) =>
  entry.label ?? t(entry.labelKey ?? '')
const toolLabel = (tool: CatalogToolEntry) =>
  tool.label ?? t(tool.labelKey ?? tool.name)

/** Only what the list does not tell: the permissions a plugin runs with */
const sourceInfo = (entry: CatalogSourceEntry) =>
  entry.capabilities?.length
    ? t('toolPermissions.pluginCapabilities', {
        capabilities: entry.capabilities.join(', '),
      })
    : undefined

const isSourceOn = (entry: CatalogSourceEntry) =>
  isSourceAvailable(catalog.value, entry.source)

function setSourceOn(entry: CatalogSourceEntry, isEnabled: boolean) {
  userConfig.value.tools = withSourceAvailable(
    catalog.value,
    entry.source,
    isEnabled
  )
}

function setToolOn(tool: CatalogToolEntry, isEnabled: boolean) {
  userConfig.value.tools = withToolAvailable(catalog.value, tool, isEnabled)
}
</script>
