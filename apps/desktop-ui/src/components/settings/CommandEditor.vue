<template>
  <div class="command-editor">
    <p v-if="unavailableReason" class="command-warning">
      {{ t(unavailableReason) }}
    </p>

    <FieldRow
      class="command-field"
      vertical
      density="compact"
      required
      :label="t('commands.nameLabel')"
      :warning="nameWarnings"
    >
      <FieldInput
        :model-value="command.name"
        :placeholder="t('commands.namePlaceholder')"
        :autofocus="autofocusName"
        @update:model-value="update({ name: $event })"
      />
    </FieldRow>

    <!-- focusout: a command left without a name takes one from what it runs -->
    <div class="command-tool-fields" @focusout="suggestName">
      <CustomActionFields
        v-if="customActionOperation"
        :key="command.id"
        :command="command"
        @update="updateOperationConfig"
      />
      <OperationConfigFields
        v-else-if="tool"
        :key="`${command.id}:tools`"
        :command="command"
        :tool="tool"
        :user-config="userConfig"
        @update="updateOperationConfig"
      />
      <p v-else class="command-warning">
        {{ t('commands.unknownType', { type: command.operationId }) }}
      </p>
    </div>

    <section v-if="canTest" class="command-group">
      <DisclosureHeader
        :expanded="isTestOpen"
        :controls="testBodyId"
        density="compact"
        icon-size="md"
        @toggle="isTestOpen = !isTestOpen"
      >
        <span class="command-group-title">{{ t('commands.testGroup') }}</span>
      </DisclosureHeader>
      <div v-show="isTestOpen" :id="testBodyId" class="command-group-body">
        <CommandTestRun :command="command" />
      </div>
    </section>

    <section class="command-group command-group-advanced">
      <DisclosureHeader
        :expanded="isAdvancedOpen"
        :controls="advancedBodyId"
        density="compact"
        icon-size="md"
        @toggle="isAdvancedOpen = !isAdvancedOpen"
      >
        <span class="command-group-title">{{ t('commands.advanced') }}</span>
        <template v-if="hasAdvancedCustomizations" #status>
          <Badge data-testid="command-advanced-badge" tone="muted" size="xs">
            {{ advancedCustomizationsCount }}
          </Badge>
        </template>
      </DisclosureHeader>
      <div
        v-show="isAdvancedOpen"
        :id="advancedBodyId"
        class="command-group-body"
      >
        <section class="command-group">
          <h4 class="command-group-title">
            {{ t('commands.launcherResultGroup') }}
            <InfoTooltip :text="t('commands.launcherSelectionHint')" />
          </h4>
          <label class="command-place-detail command-place-result">
            <span class="command-place-result-label">{{
              t('commands.launcherResult')
            }}</span>
            <FieldSelect
              :model-value="isDetachedScript ? 'none' : command.outputAction"
              :title="t('commands.launcherResult')"
              :options="afterRunOptions"
              :disabled="isDetachedScript"
              @update:model-value="
                updateOutputAction($event as CommandOutputAction)
              "
            />
          </label>
          <p v-if="isDetachedScript" class="command-place-detail command-hint">
            {{ t('commands.detachedOutputActionHint') }}
          </p>
          <p
            v-else-if="command.isVoiceEnabled && tool?.voiceOutputAction"
            class="command-place-detail command-hint"
          >
            {{ t('commands.voiceOutputActionHint') }}
          </p>
        </section>
        <div class="command-field-row">
          <FieldSwitch
            :model-value="command.isAvailableExternally"
            :label="t('commands.external')"
            @update:model-value="update({ isAvailableExternally: $event })"
          />
          <InfoTooltip :text="t('commands.externalInfo')" />
          <span v-if="command.isAvailableExternally" class="command-cli-call">
            <code class="command-cli" :title="cliCommand">{{
              cliCommand
            }}</code>
            <CopyButton :value="cliCommand" :label="t('commands.copyCli')" />
          </span>
        </div>
        <div v-if="command.isAvailableExternally" class="command-field-row">
          <FieldSwitch
            :model-value="command.isQuietRunAllowed === true"
            :disabled="
              Boolean(quietRunIssue) && command.isQuietRunAllowed !== true
            "
            :label="t('commands.allowQuietRun')"
            @update:model-value="update({ isQuietRunAllowed: $event })"
          />
          <InfoTooltip :text="t(quietRunIssue ?? 'commands.quietRunInfo')" />
          <span v-if="quietRunIssue" class="command-hint">{{
            t(quietRunIssue)
          }}</span>
        </div>
        <p
          v-if="command.isAvailableExternally && nameConflicts.length"
          class="command-warning"
        >
          {{
            t('commands.warningExternalNameTwins', {
              names: nameConflicts.map(commandLabel).join(', '),
            })
          }}
        </p>
        <div v-if="tool?.canLogOutput" class="command-field-row">
          <FieldSwitch
            :model-value="command.isOutputLogged"
            :label="t('settings.actionLogOutput')"
            @update:model-value="update({ isOutputLogged: $event })"
          />
          <InfoTooltip :text="t('settings.actionLogOutputInfo')" />
          <Button
            class="command-open-log"
            size="xs"
            variant="ghost"
            icon="mdi:file-document-outline"
            @click="openLog"
          >
            {{ t('commands.openLog') }}
          </Button>
        </div>
        <FieldRow
          v-if="tool?.canSelectPlatforms"
          group
          class="command-field"
          density="compact"
          :label="t('commands.platforms')"
          :info="t('commands.platformsInfo')"
        >
          <div class="flex flex-wrap gap-3">
            <FieldCheckbox
              v-for="platform in COMMAND_PLATFORMS"
              :key="platform"
              :label="platformLabels[platform]"
              :model-value="command.platforms?.includes(platform) ?? false"
              :data-testid="`command-platform-${platform}`"
              @update:model-value="togglePlatform(platform, $event)"
            />
          </div>
        </FieldRow>
        <CommandVoiceFields
          :command="command"
          :user-config="userConfig"
          @update="update"
        />
        <div v-if="canParseArguments" class="command-field-row">
          <FieldSwitch
            :model-value="command.isLlmArgumentParsingEnabled"
            :label="t('commands.llmArgumentParsing')"
            @update:model-value="
              update({ isLlmArgumentParsingEnabled: $event })
            "
          />
          <InfoTooltip :text="t('commands.llmArgumentParsingInfo')" />
        </div>
        <div v-if="canPreTransform" class="command-field-row">
          <FieldSwitch
            :model-value="command.isLlmPreTransformEnabled ?? false"
            :label="t('commands.llmPreTransform')"
            @update:model-value="update({ isLlmPreTransformEnabled: $event })"
          />
          <InfoTooltip :text="t('commands.llmPreTransformInfo')" />
        </div>
        <FieldRow
          v-if="canPreTransform && command.isLlmPreTransformEnabled"
          class="command-field"
          vertical
          density="compact"
          :label="t('commands.llmPreTransformPromptLabel')"
        >
          <FieldPromptTextArea
            class="command-llm-pre-transform-prompt"
            :model-value="command.llmPreTransformPrompt ?? ''"
            :placeholder="t('commands.llmPreTransformPromptPlaceholder')"
            :modal-title="t('commands.llmPreTransformPromptLabel')"
            @update:model-value="update({ llmPreTransformPrompt: $event })"
          />
          <template #info>
            <InfoTooltip :text="t('commands.llmPreTransformPromptInfo')" />
          </template>
        </FieldRow>
        <FieldRow
          class="command-field"
          vertical
          density="compact"
          :label="t('commands.descriptionLabel')"
        >
          <FieldTextArea
            class="command-description"
            :model-value="command.description ?? ''"
            :placeholder="t('commands.descriptionPlaceholder')"
            @update:model-value="updateDescription"
          />

          <template #info
            ><InfoTooltip :text="t('commands.descriptionInfo')"
          /></template>
        </FieldRow>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { aiCommandOperationConfigOf } from '../../lib/ai-commands/ai-command-config'
import { isQuietTool } from '../../lib/chat-tools/tool-catalog'
import {
  normalizeCommands,
  outputActionOf,
  scriptOperationConfig,
} from '../../lib/commands/command-config'
import {
  countAdvancedCustomizations,
  createCommandEditorModel,
} from '../../lib/commands/command-editor-model'
import {
  commandCliCall,
  normalizeCommandName,
  platformCliShell,
} from '../../lib/commands/command-external'
import {
  commandLabel,
  commandOperation,
  commandUnavailableReason,
  suggestCommandName,
  validateCommand,
} from '../../lib/commands/command-runtime'
import { canTestCommand } from '../../lib/commands/command-test-run'
import {
  operationInputSchema,
  schemaShape,
} from '../../lib/operations/operation-input'
import { canOperationRunQuietly } from '../../lib/operations/quiet-operation'
import { useIpcStore } from '../../stores/ipc'
import { useOperationsStore } from '../../stores/operations'
import Badge from '../common/Badge.vue'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import CommandTestRun from './CommandTestRun.vue'
import CommandVoiceFields from './CommandVoiceFields.vue'
import CustomActionFields from './CustomActionFields.vue'
import OperationConfigFields from './OperationConfigFields.vue'
import {
  COMMAND_PLATFORMS,
  type CommandConfig,
  type CommandOutputAction,
  type CommandPlatform,
  type UserConfig,
} from '@tyco/shared'

const props = withDefaults(
  defineProps<{
    command: CommandConfig
    /** Other commands an external call by this name could mean */
    nameConflicts?: CommandConfig[]
    /** For the settings of the tool: translation languages, AI tasks */
    userConfig?: UserConfig
    autofocusName?: boolean
  }>(),
  { nameConflicts: () => [] }
)

const emit = defineEmits<{
  (event: 'update', command: CommandConfig): void
  /** Opens another tab of the settings */
  (event: 'navigate', tab: string): void
}>()

const { t } = useI18n()
const { toastKey } = useToast()
const ipcStore = useIpcStore()

const operationsStore = useOperationsStore()
const tool = computed(() => commandOperation(props.command, operationsStore))
const quietRunIssue = computed(() => {
  const commands = normalizeCommands(props.userConfig?.commands)
  const pending = [props.command]
  const seen = new Set<string>()
  while (pending.length) {
    const command = pending.pop()!
    if (seen.has(command.id) || command.isEnabled === false) continue
    seen.add(command.id)
    const operation = commandOperation(command, operationsStore)
    if (!operation || !canOperationRunQuietly(operation))
      return 'commands.quietOperationUnsupported'
    if (command.operationId !== 'core.aiTask') continue
    for (const ref of aiCommandOperationConfigOf(command.operationConfig)
      .tools) {
      if (ref.policy === 'ask') return 'commands.quietConfirmationRequired'
      if (
        !isQuietTool({ kind: ref.sourceKind, id: ref.sourceId }, ref.toolName)
      )
        return 'commands.quietToolUnsupported'
      if (ref.sourceKind === 'commands' && ref.toolName) {
        const nested = commands.find(({ id }) => id === ref.toolName)
        if (nested) pending.push(nested)
      }
    }
  }
  return undefined
})
/** A script or a webhook: its settings have an editor of their own */
const customActionOperation = computed(
  () =>
    props.command.operationId === 'script' ||
    props.command.operationId === 'webhook'
)
const canTest = computed(() => canTestCommand(props.command))
/** AI commands do not use pre-transformation */
const canPreTransform = computed(
  () => props.command.operationId !== 'core.aiTask'
)
/**
 * A tool with a structured input and no parser of its own takes a text only
 * when the LLM fills its input from it
 */
const canParseArguments = computed(
  () =>
    Boolean(tool.value) &&
    !tool.value!.parseText &&
    schemaShape(
      operationInputSchema(tool.value!, props.command.operationConfig)
    ) === 'structured'
)
/** Why the command cannot run, unless its tool is missing altogether */
const unavailableReason = computed(() =>
  tool.value
    ? commandUnavailableReason(props.command, operationsStore)
    : undefined
)
const issues = computed(() => validateCommand(props.command, operationsStore))
const warningsFor = (field: string) =>
  issues.value
    .filter((issue) => issue.field === field)
    .map((issue) => t(issue.messageKey))
const nameWarnings = computed(() => warningsFor('name'))

const { update, updateDescription, updateOperationConfig, updateOutputAction } =
  createCommandEditorModel({
    getCommand: () => props.command,
    update: (command) => emit('update', command),
  })

function suggestName() {
  if (props.command.name.trim()) return
  const name = suggestCommandName(props.command)
  if (name) update({ name })
}

const afterRunOptions = computed(() => [
  { id: 'showMenu', name: t('commands.afterRunShowResult') },
  { id: 'insertIntoWindow', name: t('commands.afterRunInsert') },
  { id: 'copyToClipboard', name: t('commands.afterRunCopy') },
  { id: 'none', name: t('settings.actionAfterRunNone') },
])

/** Shown open when one of its settings is set, so it is not missed */
const isTestOpen = ref(false)
const testBodyId = useId()
const advancedBodyId = useId()
const defaultOutputAction = computed<CommandOutputAction>(() =>
  outputActionOf(tool.value?.defaultOutputAction)
)
const isDetachedScript = computed(
  () =>
    props.command.operationId === 'script' &&
    scriptOperationConfig(props.command).isDetached
)
const advancedCustomizationsCount = computed(() =>
  countAdvancedCustomizations(props.command, {
    defaultOutputAction: defaultOutputAction.value,
    canSelectPlatforms: tool.value?.canSelectPlatforms,
    canLogOutput: tool.value?.canLogOutput,
    canPreTransform: canPreTransform.value,
    canParseArguments: canParseArguments.value,
    isDetached: isDetachedScript.value,
  })
)
const hasAdvancedCustomizations = computed(
  () => advancedCustomizationsCount.value > 0
)
const isAdvancedOpen = ref<boolean>(false)

const platformLabels = computed<Record<CommandPlatform, string>>(() => ({
  linux: t('commands.platformLinux'),
  windows: t('commands.platformWindows'),
}))

/** None checked runs the command on every platform */
function togglePlatform(platform: CommandPlatform, isChecked: boolean) {
  const current = props.command.platforms ?? []
  const next = COMMAND_PLATFORMS.filter((item) =>
    item === platform ? isChecked : current.includes(item)
  )
  update({ platforms: next })
}

/** By the name, which reads better, while it is unique; otherwise by the id */
const cliShell = platformCliShell(
  typeof navigator === 'undefined' ? '' : navigator.userAgent
)
const cliCommand = computed(() =>
  normalizeCommandName(props.command.name) && !props.nameConflicts.length
    ? commandCliCall(props.command.name.trim(), true, cliShell)
    : commandCliCall(props.command.id, false, cliShell)
)

async function openLog() {
  const res = await ipcStore.call('open_action_log')
  if (!res.success) toastKey('commands.openLogFailed', 'error')
  else if (!res.result) toastKey('commands.logEmpty')
}
</script>

<style scoped>
.command-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg, 1rem);
  width: 100%;
}

.command-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
  width: 100%;
}

.command-group {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
  padding-top: var(--space-md, 0.75rem);
  border-top: 1px solid var(--app-border-subtle, var(--app-border));
}

.command-group-title {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  margin: 0;
  font-size: var(--text-caption);
  font-weight: 600;
  color: var(--app-text-muted);
}

.command-group-body {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
}

.command-place-detail {
  margin: 0;
  padding-left: var(--space-md, 1rem);
}

.command-place-result {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
}

.command-place-result-label {
  flex: 0 0 9rem;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.command-place-result > :last-child {
  flex: 1;
  min-width: 0;
}

.command-open-log {
  margin-left: auto;
}

.command-description {
  min-height: 4rem;
}

.command-llm-pre-transform-prompt,
:deep(.command-llm-pre-transform-prompt textarea) {
  min-height: 4rem;
}

.command-cli-call {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  min-width: 0;
  margin-left: auto;
}

.command-cli {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
  user-select: all;
}

.command-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}

.command-warning {
  font-size: var(--text-caption);
  color: var(--color-warning);
}
</style>
