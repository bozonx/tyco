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

    <CommandVoiceFields
      :command="command"
      :user-config="userConfig"
      @update="update"
    />

    <!-- focusout: a command left without a name takes one from what it runs -->
    <div class="command-tool-fields" @focusout="suggestName">
      <CustomActionFields
        v-if="customActionTool"
        :key="command.id"
        :command="command"
        @update="updateToolConfig"
      />
      <ToolConfigFields
        v-else-if="tool"
        :key="`${command.id}:tools`"
        :command="command"
        :tool="tool"
        :user-config="userConfig"
        @patch="update({ toolConfig: { ...command.toolConfig, ...$event } })"
        @update="updateToolConfig"
      />
      <p v-else class="command-warning">
        {{ t('commands.unknownTool', { tool: command.toolId }) }}
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
              :model-value="command.outputAction"
              :title="t('commands.launcherResult')"
              :options="afterRunOptions"
              @update:model-value="
                updateOutputAction($event as CommandOutputAction)
              "
            />
          </label>
          <p v-if="backgroundScript" class="command-place-detail command-hint">
            {{ t('commands.afterRunNoneScriptHint') }}
          </p>
        </section>
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
        <FieldRow
          v-if="command.toolId === 'script'"
          class="command-field"
          vertical
          density="compact"
          :label="t('commands.timeoutLabel')"
        >
          <FieldNumber
            :min="1"
            :max="SCRIPT_MAX_TIMEOUT_SEC"
            :step="1"
            :model-value="scriptConfig.timeoutSec ?? ''"
            :placeholder="String(SCRIPT_OUTPUT_TIMEOUT_SEC)"
            @update:model-value="updateTimeout"
          />

          <template #info
            ><InfoTooltip
              :text="
                t('commands.timeoutInfo', {
                  seconds: SCRIPT_OUTPUT_TIMEOUT_SEC,
                  max: SCRIPT_MAX_TIMEOUT_SEC,
                })
              "
          /></template>
        </FieldRow>
        <div class="command-field-row">
          <template v-if="tool?.canLogOutput">
            <FieldSwitch
              :model-value="command.isOutputLogged"
              :label="t('settings.actionLogOutput')"
              @update:model-value="update({ isOutputLogged: $event })"
            />
            <InfoTooltip :text="t('settings.actionLogOutputInfo')" />
          </template>
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
        <div class="command-field-row">
          <FieldSwitch
            :model-value="command.isLlmPreTransformEnabled ?? false"
            :label="t('commands.llmPreTransform')"
            @update:model-value="update({ isLlmPreTransformEnabled: $event })"
          />
          <InfoTooltip :text="t('commands.llmPreTransformInfo')" />
        </div>
        <FieldRow
          v-if="command.isLlmPreTransformEnabled"
          class="command-field"
          vertical
          density="compact"
          :label="t('commands.llmPreTransformPromptLabel')"
          :warning="preTransformWarnings"
        >
          <FieldTextArea
            class="command-llm-pre-transform-prompt"
            :model-value="command.llmPreTransformPrompt ?? ''"
            :placeholder="t('commands.llmPreTransformPromptPlaceholder')"
            auto-resize
            @update:model-value="update({ llmPreTransformPrompt: $event })"
          />
          <template #info>
            <InfoTooltip :text="t('commands.llmPreTransformPromptInfo')" />
          </template>
        </FieldRow>
        <p v-if="origin" class="command-hint command-origin">{{ origin }}</p>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, useId } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { scriptToolConfig } from '../../lib/commands/command-config'
import { createCommandEditorModel } from '../../lib/commands/command-editor-model'
import {
  commandCliCall,
  normalizeCommandName,
} from '../../lib/commands/command-external'
import {
  commandLabel,
  commandTool,
  commandUnavailableReason,
  suggestCommandName,
  validateCommand,
} from '../../lib/commands/command-runtime'
import { canTestCommand } from '../../lib/commands/command-test-run'
import { toolLabel } from '../../lib/tools/tool-label'
import { useIpcStore } from '../../stores/ipc'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import CopyButton from '../common/CopyButton.vue'
import DisclosureHeader from '../common/DisclosureHeader.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import CommandTestRun from './CommandTestRun.vue'
import CommandVoiceFields from './CommandVoiceFields.vue'
import CustomActionFields from './CustomActionFields.vue'
import ToolConfigFields from './ToolConfigFields.vue'
import {
  type CommandConfig,
  type CommandOutputAction,
  SCRIPT_MAX_TIMEOUT_SEC,
  SCRIPT_OUTPUT_TIMEOUT_SEC,
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

const toolsStore = useToolsStore()
const tool = computed(() => commandTool(props.command, toolsStore))
/** A script or a webhook: its settings have an editor of their own */
const customActionTool = computed(
  () => props.command.toolId === 'script' || props.command.toolId === 'webhook'
)
const canTest = computed(() => canTestCommand(props.command))
const scriptConfig = computed(() => scriptToolConfig(props.command))
/** Why the command cannot run, unless its tool is missing altogether */
const unavailableReason = computed(() =>
  tool.value ? commandUnavailableReason(props.command, toolsStore) : undefined
)
const nameWarnings = computed(() =>
  validateCommand(props.command, toolsStore)
    .filter((issue) => issue.field === 'name')
    .map((issue) => t(issue.messageKey))
)
const preTransformWarnings = computed(() =>
  validateCommand(props.command, toolsStore)
    .filter((issue) => issue.field === 'llmPreTransformPrompt')
    .map((issue) => t(issue.messageKey))
)

const {
  update,
  updateDescription,
  updateToolConfig,
  updateTimeout,
  updateOutputAction,
} = createCommandEditorModel({
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

/**
 * Only command launcher runs configured to ignore output may stay in the
 * background.
 */
const backgroundScript = computed(
  () =>
    props.command.toolId === 'script' && props.command.outputAction === 'none'
)

/** Which tool the command runs */
const origin = computed(() =>
  t('commands.toolInfo', {
    tool: tool.value ? toolLabel(tool.value, t) : props.command.toolId,
  })
)

/** Shown open when one of its settings is set, so it is not missed */
const isTestOpen = ref(false)
const testBodyId = useId()
const advancedBodyId = useId()
const isAdvancedOpen = ref<boolean>(
  Boolean(props.command.description) ||
    Boolean(scriptConfig.value.timeoutSec) ||
    Boolean(props.command.isOutputLogged) ||
    Boolean(props.command.isAvailableExternally) ||
    Boolean(props.command.isLlmPreTransformEnabled)
)

/** By the name, which reads better, while it is unique; otherwise by the id */
const cliCommand = computed(() =>
  normalizeCommandName(props.command.name) && !props.nameConflicts.length
    ? commandCliCall(props.command.name.trim(), true)
    : commandCliCall(props.command.id)
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

.command-llm-pre-transform-prompt {
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

.command-origin {
  margin: 0;
  text-align: right;
}

.command-warning {
  font-size: var(--text-caption);
  color: var(--color-warning);
}
</style>
