<template>
  <div class="settings-stack">
    <SettingsSection
      :title="t('settings.toolsTab')"
      :info="t('toolPermissions.catalogHint')"
    >
      <div class="settings-section-content">
        <template v-for="entry in sources" :key="sourceKey(entry.source)">
          <SettingsEntityItem
            :icon="entry.icon"
            icon-tone="secondary"
            :title="entry.label ?? t(entry.labelKey ?? '')"
            :info="entry.description ?? t(entry.descriptionKey ?? '')"
          >
            <Badge tone="muted">{{ sourceKindText(entry) }}</Badge>
            <FieldSwitch
              v-if="canSwitch(entry)"
              :aria-label="entry.label ?? t(entry.labelKey ?? '')"
              :model-value="isSourceAvailable(userConfig.tools, entry.source)"
              @update:model-value="setAvailable(entry, $event)"
            />
          </SettingsEntityItem>
          <div class="tool-catalog-details">
            <div
              v-for="tool in entry.tools"
              :key="tool.name"
              class="tool-catalog-row"
            >
              <span class="tool-catalog-name">
                {{ tool.label ?? t(tool.labelKey ?? tool.name) }}
              </span>
              <Badge :tone="isRiskyTool(tool.risk) ? 'warning' : 'muted'">
                {{ t(TOOL_RISK_LABEL_KEYS[tool.risk]) }}
              </Badge>
              <Badge tone="muted">
                {{
                  t('toolPermissions.defaultPolicy', {
                    policy: t(TOOL_POLICY_LABEL_KEYS[defaultToolPolicy(tool)]),
                  })
                }}
              </Badge>
            </div>
            <p v-if="entry.capabilities?.length" class="tool-catalog-hint">
              {{
                t('toolPermissions.pluginCapabilities', {
                  capabilities: entry.capabilities.join(', '),
                })
              }}
            </p>
          </div>
        </template>
        <InlineNotice
          density="compact"
          kind="info"
          icon="mdi:information-outline"
          :message="t('toolPermissions.catalogWhereHint')"
        />
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
  isRiskyTool,
  isSourceAvailable,
  sourceKey,
} from '../../lib/chat-tools/tool-catalog'
import {
  CORE_CATALOG,
  type CatalogSourceEntry,
  TOOL_POLICY_LABEL_KEYS,
  TOOL_RISK_LABEL_KEYS,
} from '../../lib/chat-tools/tool-catalog-entries'
import Badge from '../common/Badge.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SettingsEntityItem from './SettingsEntityItem.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()
const pluginSources = usePluginToolSources()

const sources = computed(() => [...CORE_CATALOG, ...pluginSources.value])

/** Built-in sources are switched where they are used, never everywhere */
const canSwitch = (entry: CatalogSourceEntry) =>
  entry.source.kind === 'plugin' || entry.source.kind === 'mcp'

function sourceKindText(entry: CatalogSourceEntry) {
  if (entry.source.kind === 'plugin')
    return t(
      entry.isThirdParty
        ? 'toolPermissions.sourceThirdPartyPlugin'
        : 'toolPermissions.sourcePlugin'
    )
  return t('toolPermissions.sourceCore')
}

function setAvailable(entry: CatalogSourceEntry, isEnabled: boolean) {
  const key = sourceKey(entry.source)
  const { [key]: _removed, ...rest } = userConfig.value.tools?.sources ?? {}
  userConfig.value.tools = {
    ...userConfig.value.tools,
    sources: isEnabled ? rest : { ...rest, [key]: { isEnabled: false } },
  }
}
</script>

<style scoped>
.tool-catalog-details {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  padding-inline-start: var(--space-lg);
  border-inline-start: 2px solid var(--app-border-subtle);
}
.tool-catalog-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--space-sm);
}
.tool-catalog-name {
  flex: 1 1 10rem;
  font-size: var(--text-caption);
}
.tool-catalog-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
