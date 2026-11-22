<template>
  <FieldRow
    vertical
    density="compact"
    :label="t('commands.aiPromptLabel')"
    :info="t('commands.aiPromptInfo')"
    :warning="warnings"
  >
    <div class="flex items-start gap-1">
      <FieldPromptTextArea
        class="flex-1"
        :model-value="config.prompt"
        :placeholder="t('commands.aiPromptPlaceholder')"
        :modal-title="t('commands.aiPromptLabel')"
        auto-resize
        @update:model-value="emit('update', 'prompt', $event)"
      />
      <VariableInsertMenu
        @insert="emit('update', 'prompt', `${config.prompt}${$event}`)"
      />
    </div>
    <VariableReferenceHints :templates="[config.prompt]" />
  </FieldRow>
  <FieldRow
    vertical
    density="compact"
    :label="t('commands.aiTools')"
    :info="t('commands.aiToolsInfo')"
  >
    <div class="ai-command-list">
      <template v-for="group in candidateGroups" :key="group.id">
        <p class="ai-command-group">{{ group.label }}</p>
        <div
          v-for="item in group.items"
          :key="refKey(item.ref)"
          class="ai-command-item"
        >
          <FieldCheckbox
            :model-value="isSelected(item.ref)"
            :label="item.label"
            @update:model-value="toggleTool(item.ref, $event)"
          />
          <Badge v-if="isRiskyTool(item.risk)" tone="warning">
            {{ t(TOOL_RISK_LABEL_KEYS[item.risk]) }}
          </Badge>
        </div>
        <p v-if="!group.items.length" class="ai-command-empty">
          {{ group.emptyMessage }}
        </p>
      </template>
      <template v-if="unavailable.length">
        <p class="ai-command-group">{{ t('commands.aiToolsUnavailable') }}</p>
        <div
          v-for="ref in unavailable"
          :key="refKey(ref)"
          class="ai-command-item"
        >
          <FieldCheckbox
            :model-value="true"
            :label="ref.toolName ?? ref.sourceId"
            @update:model-value="toggleTool(ref, false)"
          />
          <Badge tone="muted">{{ t('commands.aiToolUnavailable') }}</Badge>
        </div>
      </template>
    </div>
    <InlineNotice
      v-if="hasRiskyTools"
      density="compact"
      kind="warning"
      icon="mdi:alert-outline"
      :message="t('commands.aiToolsRiskyWarning')"
    />
  </FieldRow>
  <FieldRow
    v-if="config.tools.length"
    :label="t('commands.aiMaxSteps')"
    :info="t('commands.aiMaxStepsInfo')"
  >
    <FieldNumber
      min="1"
      :max="MAX_TOOL_STEPS"
      :model-value="config.maxSteps ?? ''"
      :placeholder="String(maxToolStepsOf(userConfig?.llm))"
      @update:model-value="setMaxSteps"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { usePluginToolSources } from '../../composables/use-plugin-tool-sources'
import {
  aiCommandOperationConfigOf,
  callableCommands,
  commandRiskLookup,
} from '../../lib/ai-commands/ai-command-config'
import {
  commandRisk,
  commandToolRef,
  isRiskyTool,
  isSameToolRef,
  isSourceAvailable,
  whitelistHas,
} from '../../lib/chat-tools/tool-catalog'
import {
  CORE_CATALOG,
  TOOL_RISK_LABEL_KEYS,
} from '../../lib/chat-tools/tool-catalog-entries'
import { normalizeCommands } from '../../lib/commands/command-config'
import { commandLabel } from '../../lib/commands/command-runtime'
import Badge from '../common/Badge.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineNotice from '../common/InlineNotice.vue'
import VariableInsertMenu from './VariableInsertMenu.vue'
import VariableReferenceHints from './VariableReferenceHints.vue'
import {
  type CommandConfig,
  MAX_TOOL_STEPS,
  type ToolRef,
  type ToolRisk,
  type UserConfig,
  maxToolStepsOf,
} from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig?: UserConfig
  warnings: string[]
}>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()

const config = computed(() =>
  aiCommandOperationConfigOf(props.command.operationConfig)
)

interface ToolCandidate {
  ref: ToolRef
  label: string
  risk: ToolRisk
}

const commands = computed(() => normalizeCommands(props.userConfig?.commands))
const pluginSources = usePluginToolSources()

/** What the agent may be allowed to call, by source */
const candidateGroups = computed(() => {
  const web = CORE_CATALOG.find((entry) => entry.source.id === 'web')!
  const lookup = commandRiskLookup(commands.value)
  return [
    {
      id: 'web',
      label: t(web.labelKey!),
      emptyMessage: '',
      items: web.tools.map((tool): ToolCandidate => ({
        ref: { sourceKind: 'core', sourceId: 'web', toolName: tool.name },
        label: t(tool.labelKey!),
        risk: tool.risk,
      })),
    },
    {
      id: 'commands',
      label: t('chatTools.commands.group'),
      emptyMessage: t('commands.aiNoOtherCommands'),
      // any command but this one
      items: callableCommands(props.command, commands.value).map(
        (command): ToolCandidate => ({
          ref: commandToolRef(command.id),
          label: commandLabel(command),
          risk: commandRisk(command, lookup),
        })
      ),
    },
    ...pluginSources.value
      .filter((entry) =>
        isSourceAvailable(props.userConfig?.tools, entry.source)
      )
      .map((entry) => ({
        id: `plugin:${entry.source.id}`,
        label: entry.label ?? entry.source.id,
        emptyMessage: '',
        items: entry.tools.map((tool): ToolCandidate => ({
          ref: {
            sourceKind: 'plugin',
            sourceId: entry.source.id,
            toolName: tool.name,
          },
          label: t(tool.labelKey ?? tool.name),
          risk: tool.isThirdParty ? 'external' : tool.risk,
        })),
      })),
  ]
})

const candidates = computed(() =>
  candidateGroups.value.flatMap((group) => group.items)
)

const refKey = (ref: ToolRef) =>
  [ref.sourceKind, ref.sourceId, ref.toolName ?? ''].join(':')

const isSelected = (ref: ToolRef) =>
  whitelistHas(
    config.value.tools,
    { kind: ref.sourceKind, id: ref.sourceId },
    ref.toolName ?? ''
  )

/** What the whitelist names that is not there now: it is left out of a run */
const unavailable = computed(() =>
  config.value.tools.filter(
    (ref) =>
      !candidates.value.some(
        (item) =>
          isSameToolRef(item.ref, ref) ||
          (ref.toolName === undefined &&
            item.ref.sourceKind === ref.sourceKind &&
            item.ref.sourceId === ref.sourceId)
      )
  )
)

const hasRiskyTools = computed(() =>
  candidates.value.some(
    (item) => isSelected(item.ref) && isRiskyTool(item.risk)
  )
)

function toggleTool(ref: ToolRef, isAllowed: boolean) {
  // a whole source on the list is split into its tools to take one off
  const expanded = config.value.tools.flatMap((item) =>
    item.toolName === undefined &&
    item.sourceKind === ref.sourceKind &&
    item.sourceId === ref.sourceId
      ? candidates.value
          .filter(
            (candidate) =>
              candidate.ref.sourceKind === ref.sourceKind &&
              candidate.ref.sourceId === ref.sourceId
          )
          .map((candidate) => candidate.ref)
      : [item]
  )
  const others = expanded.filter((item) => !isSameToolRef(item, ref))
  emit('update', 'tools', isAllowed ? [...others, ref] : others)
}

/**
 * An empty field takes the limit of the LLM settings; a number out of range or
 * half typed is not taken
 */
function setMaxSteps(text: string) {
  if (!text.trim()) {
    emit('update', 'maxSteps', undefined)
    return
  }
  const steps = Number(text)
  if (Number.isInteger(steps) && steps >= 1 && steps <= MAX_TOOL_STEPS)
    emit('update', 'maxSteps', steps)
}
</script>
<style scoped>
.ai-command-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-height: 14rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ai-command-group {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-caption);
  font-weight: 600;
}

.ai-command-item {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
}

.ai-command-empty {
  margin: 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
