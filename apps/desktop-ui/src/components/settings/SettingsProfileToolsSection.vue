<template>
  <SettingsSection
    :title="t('settings.profileTools')"
    :info="t('settings.profileToolsHint')"
  >
    <div class="settings-section-content">
      <SettingsToolSource
        v-for="entry in sources"
        :key="sourceKey(entry.source)"
        :icon="entry.icon"
        :title="sourceLabel(entry)"
        :info="sourceInfo(entry)"
        :off="!isAvailable(entry) || !isEnabled(entry)"
      >
        <template #actions>
          <Badge v-if="!isAvailable(entry)" tone="muted">
            {{ t('toolPermissions.sourceOffEverywhere') }}
          </Badge>
          <FieldSwitch
            :aria-label="sourceLabel(entry)"
            :disabled="!isAvailable(entry)"
            :model-value="isAvailable(entry) && isEnabled(entry)"
            @update:model-value="
              emit('update', withSourceEnabled(tools, entry.source, $event))
            "
          />
        </template>
        <template v-if="isAvailable(entry) && isEnabled(entry)">
          <SettingsToolRow
            v-for="tool in entry.tools"
            :key="tool.name"
            :name="tool.name"
            :label="toolLabel(tool)"
            :risk="tool.risk"
          >
            <Badge v-if="!isToolAvailable(catalog, tool)" tone="muted">
              {{ t('toolPermissions.toolOffEverywhere') }}
            </Badge>
            <SegmentedControl
              v-else
              size="sm"
              :label="toolLabel(tool)"
              :model-value="stateOf(tool)"
              :options="stateOptions"
              @update:model-value="
                emit('update', withToolState(tools, tool, $event as ToolState))
              "
            />
          </SettingsToolRow>
        </template>
      </SettingsToolSource>
      <slot />
    </div>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  type CatalogTool,
  effectiveToolState,
  isSourceAvailable,
  isSourceEnabledInProfile,
  isToolAvailable,
  sourceKey,
  withSourceEnabled,
  withToolState,
} from '../../lib/chat-tools/tool-catalog'
import type {
  CatalogSourceEntry,
  CatalogToolEntry,
} from '../../lib/chat-tools/tool-catalog-entries'
import Badge from '../common/Badge.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsToolRow from './SettingsToolRow.vue'
import SettingsToolSource from './SettingsToolSource.vue'
import type {
  ProfileToolSettings,
  ToolCatalogSettings,
  ToolState,
} from '@tyco/shared'

const props = defineProps<{
  sources: readonly CatalogSourceEntry[]
  tools: ProfileToolSettings | undefined
  catalog: ToolCatalogSettings | undefined
}>()
const emit = defineEmits<{ update: [tools: ProfileToolSettings] }>()
defineSlots<{
  /** The sources picked one by one: commands, MCP servers */
  default?: () => unknown
}>()
const { t } = useI18n()

const stateOptions = computed(() => [
  {
    id: 'off',
    name: t('settings.accessOff'),
    title: t('settings.accessOffHint'),
  },
  {
    id: 'ask',
    name: t('settings.accessAsk'),
    title: t('settings.accessAskHint'),
  },
  {
    id: 'allow',
    name: t('settings.accessAllow'),
    title: t('settings.accessAllowHint'),
  },
])

const isAvailable = (entry: CatalogSourceEntry) =>
  isSourceAvailable(props.catalog, entry.source)
const isEnabled = (entry: CatalogSourceEntry) =>
  isSourceEnabledInProfile(props.tools, entry.source)
const stateOf = (tool: CatalogTool) =>
  effectiveToolState(props.catalog, props.tools, tool)

const sourceLabel = (entry: CatalogSourceEntry) =>
  entry.label ?? t(entry.labelKey ?? '')
const toolLabel = (tool: CatalogToolEntry) =>
  tool.label ?? t(tool.labelKey ?? tool.name)

function sourceInfo(entry: CatalogSourceEntry): string {
  const description = entry.description ?? t(entry.descriptionKey ?? '')
  const capabilities = entry.capabilities?.length
    ? t('toolPermissions.pluginCapabilities', {
        capabilities: entry.capabilities.join(', '),
      })
    : ''
  const webNotice =
    entry.source.kind === 'core' && entry.source.id === 'web'
      ? t('settings.profileWebSearchLlmNotice')
      : ''
  return [description, capabilities, webNotice].filter(Boolean).join('\n\n')
}
</script>
