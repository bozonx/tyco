<template>
  <SettingsSection
    :title="t('settings.profileTools')"
    :info="t('settings.profileToolsHint')"
  >
    <div class="settings-section-content">
      <template v-for="entry in sources" :key="sourceKey(entry.source)">
        <SettingsEntityItem
          :icon="entry.icon"
          icon-tone="secondary"
          :title="entry.label ?? t(entry.labelKey ?? '')"
          :info="sourceInfo(entry)"
        >
          <Badge v-if="!isAvailable(entry)" tone="muted">
            {{ t('toolPermissions.sourceOffEverywhere') }}
          </Badge>
          <FieldSwitch
            :aria-label="entry.label ?? t(entry.labelKey ?? '')"
            :disabled="!isAvailable(entry)"
            :model-value="isAvailable(entry) && isEnabled(entry)"
            @update:model-value="
              emit('update', withSourceEnabled(tools, entry.source, $event))
            "
          />
        </SettingsEntityItem>
        <div
          v-if="isAvailable(entry) && isEnabled(entry)"
          class="tool-group-details"
        >
          <div
            v-for="tool in entry.tools"
            :key="tool.name"
            class="tool-row"
            :data-tool="tool.name"
          >
            <span class="tool-row-name">
              {{ tool.label ?? t(tool.labelKey ?? tool.name) }}
            </span>
            <Badge :tone="isRiskyTool(tool.risk) ? 'warning' : 'muted'">
              {{ t(TOOL_RISK_LABEL_KEYS[tool.risk]) }}
            </Badge>
            <SegmentedControl
              size="sm"
              :label="tool.label ?? t(tool.labelKey ?? tool.name)"
              :model-value="stateOf(tool)"
              :options="stateOptions"
              @update:model-value="
                emit('update', withToolState(tools, tool, $event as ToolState))
              "
            />
          </div>
          <p v-if="entry.capabilities?.length" class="tool-row-hint">
            {{
              t('toolPermissions.pluginCapabilities', {
                capabilities: entry.capabilities.join(', '),
              })
            }}
          </p>
        </div>
      </template>
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
  isRiskyTool,
  isSourceAvailable,
  isSourceEnabledInProfile,
  sourceKey,
  withSourceEnabled,
  withToolState,
} from '../../lib/chat-tools/tool-catalog'
import {
  type CatalogSourceEntry,
  TOOL_RISK_LABEL_KEYS,
} from '../../lib/chat-tools/tool-catalog-entries'
import Badge from '../common/Badge.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'
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
  { id: 'off', name: t('settings.accessOff') },
  { id: 'ask', name: t('settings.accessAsk') },
  { id: 'allow', name: t('settings.accessAllow') },
])

const isAvailable = (entry: CatalogSourceEntry) =>
  isSourceAvailable(props.catalog, entry.source)
const isEnabled = (entry: CatalogSourceEntry) =>
  isSourceEnabledInProfile(props.tools, entry.source)
const stateOf = (tool: CatalogTool) =>
  effectiveToolState(props.catalog, props.tools, tool)

function sourceInfo(entry: CatalogSourceEntry): string {
  const description = entry.description ?? t(entry.descriptionKey ?? '')
  if (entry.source.kind === 'core' && entry.source.id === 'web')
    return `${description}\n\n${t('settings.profileWebSearchLlmNotice')}`
  return description
}
</script>

<style scoped>
.tool-group-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-inline-start: var(--space-lg);
  border-inline-start: 2px solid var(--app-border-subtle);
}
.tool-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.tool-row-name {
  flex: 1 1 10rem;
  font-size: var(--text-caption);
}
.tool-row-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
