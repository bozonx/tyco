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
    <div class="ai-tools-container">
      <div
        v-if="selectedCandidates.length || unavailable.length"
        class="ai-tools-list"
      >
        <div
          v-for="item in selectedCandidates"
          :key="refKey(item.ref)"
          class="ai-tool-row"
        >
          <div class="ai-tool-row-main">
            <AppIcon
              :icon="toolIcon(item.ref)"
              size="sm"
              class="ai-tool-row-icon"
              aria-hidden="true"
            />
            <span class="ai-tool-row-label">{{ item.label }}</span>
            <Badge v-if="isRiskyTool(item.risk)" tone="warning">
              {{ t(TOOL_RISK_LABEL_KEYS[item.risk]) }}
            </Badge>
          </div>
          <IconButton
            size="sm"
            variant="ghost"
            icon="mdi:trash-can-outline"
            :label="t('common.delete')"
            type="button"
            @click="promptRemoveTool(item)"
          />
        </div>

        <template v-if="unavailable.length">
          <p class="ai-tools-unavailable-label">
            {{ t('commands.aiToolsUnavailable') }}
          </p>
          <div
            v-for="toolRef in unavailable"
            :key="refKey(toolRef)"
            class="ai-tool-row"
          >
            <div class="ai-tool-row-main">
              <AppIcon
                :icon="toolIcon(toolRef)"
                size="sm"
                class="ai-tool-row-icon"
                aria-hidden="true"
              />
              <span class="ai-tool-row-label">{{
                toolRef.toolName ?? toolRef.sourceId
              }}</span>
              <Badge tone="muted">{{ t('commands.aiToolUnavailable') }}</Badge>
            </div>
            <IconButton
              size="sm"
              variant="ghost"
              icon="mdi:trash-can-outline"
              :label="t('common.delete')"
              type="button"
              @click="promptRemoveUnavailable(toolRef)"
            />
          </div>
        </template>
      </div>

      <p v-else class="ai-tools-empty">
        {{ t('commands.aiNoTools') }}
      </p>

      <div class="ai-tools-actions">
        <Button
          size="sm"
          variant="neutral"
          icon="mdi:plus"
          type="button"
          @click="isAddModalOpen = true"
        >
          {{ t('commands.aiAddTool') }}
        </Button>
      </div>
    </div>

    <InlineNotice
      v-if="hasRiskyTools"
      density="compact"
      kind="warning"
      icon="mdi:alert-outline"
      :message="t('commands.aiToolsRiskyWarning')"
    />

    <AiCommandAddToolModal
      :open="isAddModalOpen"
      :candidate-groups="candidateGroups"
      :is-selected="isSelected"
      @close="isAddModalOpen = false"
      @add="handleAddTool"
    />

    <ConfirmModal
      :open="toolToRemove !== null"
      :title="t('commands.aiRemoveToolConfirmTitle')"
      :message="
        t('commands.aiRemoveToolConfirmMessage', {
          name: toolToRemove?.label ?? '',
        })
      "
      :confirm-text="t('common.delete')"
      danger
      @confirm="confirmRemoveTool"
      @cancel="toolToRemove = null"
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
import { computed, ref } from 'vue'

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
import AppIcon from '../common/AppIcon.vue'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import IconButton from '../common/IconButton.vue'
import InlineNotice from '../common/InlineNotice.vue'
import AiCommandAddToolModal, {
  type ToolCandidate,
  type ToolCandidateGroup,
} from './AiCommandAddToolModal.vue'
import VariableInsertMenu from './VariableInsertMenu.vue'
import VariableReferenceHints from './VariableReferenceHints.vue'
import {
  type CommandConfig,
  MAX_TOOL_STEPS,
  type ToolRef,
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

const commands = computed(() => normalizeCommands(props.userConfig?.commands))
const pluginSources = usePluginToolSources()

const isAddModalOpen = ref(false)
const toolToRemove = ref<{ ref: ToolRef; label: string } | null>(null)

function toolIcon(ref: ToolRef): string {
  if (ref.sourceKind === 'core' && ref.sourceId === 'web') return 'mdi:web'
  if (ref.sourceKind === 'commands') return 'mdi:lightning-bolt-outline'
  if (ref.sourceKind === 'plugin') return 'mdi:puzzle-outline'
  return 'mdi:wrench-outline'
}

/** What the agent may be allowed to call, by source */
const candidateGroups = computed<ToolCandidateGroup[]>(() => {
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

const selectedCandidates = computed(() =>
  candidates.value.filter((item) => isSelected(item.ref))
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

function handleAddTool(ref: ToolRef) {
  toggleTool(ref, true)
  isAddModalOpen.value = false
}

function promptRemoveTool(item: ToolCandidate) {
  toolToRemove.value = { ref: item.ref, label: item.label }
}

function promptRemoveUnavailable(ref: ToolRef) {
  toolToRemove.value = { ref, label: ref.toolName ?? ref.sourceId }
}

function confirmRemoveTool() {
  if (!toolToRemove.value) return
  toggleTool(toolToRemove.value.ref, false)
  toolToRemove.value = null
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
.ai-tools-container {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
}

.ai-tools-list {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs);
  max-height: 16rem;
  overflow-y: auto;
  overscroll-behavior: contain;
}

.ai-tool-row {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: var(--space-sm);
  padding: var(--space-xs) var(--space-sm);
  border: 1px solid var(--app-border-subtle);
  border-radius: var(--radius-md);
  background-color: var(--app-surface-raised);
}

.ai-tool-row-main {
  display: flex;
  align-items: center;
  gap: var(--space-sm);
  min-width: 0;
  flex: 1;
}

.ai-tool-row-icon {
  flex-shrink: 0;
  color: var(--color-primary);
}

.ai-tool-row-label {
  font-size: var(--text-body);
  color: var(--color-base-content);
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.ai-tools-unavailable-label {
  margin: var(--space-xs) 0 0;
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--app-text-muted);
}

.ai-tools-empty {
  margin: var(--space-xs) 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.ai-tools-actions {
  display: flex;
  align-items: center;
  margin-top: var(--space-xs);
}
</style>
