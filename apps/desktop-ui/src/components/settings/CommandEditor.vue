<template>
  <div class="command-editor">
    <p v-if="unavailable" class="command-warning">
      {{ t(unavailable) }}
    </p>

    <label class="command-field">
      <span class="command-field-label">
        {{ t('commands.nameLabel') }}
        <span class="command-required" aria-hidden="true">*</span>
      </span>
      <FieldInput
        :value="command.name"
        :placeholder="t('commands.namePlaceholder')"
        @update:value="update({ name: $event })"
      />
      <FieldIssues :issues="nameIssues" />
    </label>

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
        @update="updateToolConfig"
      />
      <p v-else class="command-warning">
        {{ t('commands.unknownTool', { tool: command.toolId }) }}
      </p>
    </div>

    <details v-if="testable" class="command-group">
      <summary class="command-group-title command-group-toggle">
        <Icon icon="mdi:chevron-right" width="16" height="16" />
        {{ t('commands.testGroup') }}
      </summary>
      <div class="command-group-body">
        <CommandTestRun :command="command" />
      </div>
    </details>

    <details class="command-group" :open="advancedOpen">
      <summary class="command-group-title command-group-toggle">
        <Icon icon="mdi:chevron-right" width="16" height="16" />
        {{ t('commands.advanced') }}
      </summary>
      <div class="command-group-body">
        <section class="command-group">
          <h4 class="command-group-title">
            {{ t('commands.launcherResultGroup') }}
            <InfoTooltip
              v-if="takesText"
              :text="t('commands.launcherSelectionHint')"
            />
          </h4>
          <label class="command-place-detail command-place-result">
            <span class="command-place-result-label">{{
              t('commands.launcherResult')
            }}</span>
            <FieldSelect
              :value="launcherAction"
              :title="t('commands.launcherResult')"
              :options="takesText ? selectionAfterRunOptions : afterRunOptions"
              @update:value="
                updateLauncherAfterRun('action', $event as CustomActionAfterRun)
              "
            />
          </label>
          <label
            v-if="replacesSelection"
            class="command-place-detail command-place-result"
          >
            <span class="command-place-result-label">{{
              t('commands.launcherFallback')
            }}</span>
            <FieldSelect
              :value="command.launcherAfterRun.fallback"
              :title="t('commands.launcherFallback')"
              :options="afterRunOptions"
              @update:value="
                updateLauncherAfterRun(
                  'fallback',
                  $event as CustomActionAfterRun
                )
              "
            />
          </label>
          <p v-if="backgroundScript" class="command-place-detail command-hint">
            {{ t('commands.afterRunNoneScriptHint') }}
          </p>
        </section>
        <label class="command-field">
          <span class="command-field-label">
            {{ t('commands.descriptionLabel') }}
            <InfoTooltip :text="t('commands.descriptionInfo')" />
          </span>
          <FieldTextArea
            class="command-description"
            :value="command.description ?? ''"
            :placeholder="t('commands.descriptionPlaceholder')"
            @update:value="updateDescription"
          />
        </label>
        <label v-if="command.toolId === 'script'" class="command-field">
          <span class="command-field-label">
            {{ t('commands.timeoutLabel') }}
            <InfoTooltip
              :text="
                t('commands.timeoutInfo', {
                  seconds: SCRIPT_OUTPUT_TIMEOUT_SEC,
                  max: SCRIPT_MAX_TIMEOUT_SEC,
                })
              "
            />
          </span>
          <FieldNumber
            :min="1"
            :max="SCRIPT_MAX_TIMEOUT_SEC"
            :step="1"
            :value="scriptConfig.timeoutSec ?? ''"
            :placeholder="String(SCRIPT_OUTPUT_TIMEOUT_SEC)"
            @update:value="updateTimeout"
          />
        </label>
        <div class="command-field-row">
          <template v-if="tool?.logsOutput">
            <FieldCheckbox
              :value="command.logOutput"
              :label="t('settings.actionLogOutput')"
              @update:value="update({ logOutput: $event })"
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
          <FieldCheckbox
            :value="command.availableIn.external"
            :label="t('commands.external')"
            @update:value="
              update({
                availableIn: { ...command.availableIn, external: $event },
              })
            "
          />
          <InfoTooltip :text="t('commands.externalInfo')" />
          <span v-if="command.availableIn.external" class="command-cli-call">
            <code class="command-cli" :title="cliCommand">{{
              cliCommand
            }}</code>
            <IconButton
              variant="ghost"
              size="sm"
              :title="copied ? t('commands.idCopied') : t('commands.copyCli')"
              @click="copyCli"
              :label="copied ? t('commands.idCopied') : t('commands.copyCli')"
              :icon="copied ? 'mdi:check' : 'mdi:content-copy'"
            />
          </span>
        </div>
        <p
          v-if="command.availableIn.external && nameConflicts.length"
          class="command-warning"
        >
          {{
            t('commands.warningExternalNameTwins', {
              names: nameConflicts.map(commandLabel).join(', '),
            })
          }}
        </p>
        <p v-if="origin" class="command-hint command-origin">{{ origin }}</p>
      </div>
    </details>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import useToast from '../../composables/use-toast'
import { scriptToolConfig } from '../../lib/commands/command-config'
import { createCommandEditorModel } from '../../lib/commands/command-editor-model'
import {
  commandCliCall,
  normalizeCommandName,
} from '../../lib/commands/command-external'
import {
  commandAddedBy,
  commandLabel,
  commandTakesText,
  commandTool,
  commandUnavailableReason,
  suggestCommandName,
  validateCommand,
} from '../../lib/commands/command-runtime'
import { canTestCommand } from '../../lib/commands/command-test-run'
import { toolLabel } from '../../lib/tools/tool-label'
import { useIpcStore } from '../../stores/ipc'
import { useToolsStore } from '../../stores/tools'
import Icon from '../common/AppIcon.vue'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import IconButton from '../common/IconButton.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import CommandTestRun from './CommandTestRun.vue'
import CustomActionFields from './CustomActionFields.vue'
import FieldIssues from './FieldIssues.vue'
import ToolConfigFields from './ToolConfigFields.vue'
import {
  type CommandConfig,
  type CustomActionAfterRun,
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
  }>(),
  { nameConflicts: () => [] }
)

const emit = defineEmits<{
  (event: 'update', command: CommandConfig): void
  /** Opens another tab of the settings */
  (event: 'navigate', tab: string): void
}>()

const { t } = useI18n()
const { toast } = useToast()
const ipcStore = useIpcStore()

const toolsStore = useToolsStore()
const tool = computed(() => commandTool(props.command, toolsStore))
/** A script or a webhook: its settings have an editor of their own */
const customActionTool = computed(
  () => props.command.toolId === 'script' || props.command.toolId === 'webhook'
)
const takesText = computed(() => commandTakesText(props.command, toolsStore))
const testable = computed(() => canTestCommand(props.command))
const scriptConfig = computed(() => scriptToolConfig(props.command))
/** Why the command cannot run, unless its tool is missing altogether */
const unavailable = computed(() =>
  tool.value ? commandUnavailableReason(props.command, toolsStore) : undefined
)
const nameIssues = computed(() =>
  validateCommand(props.command, toolsStore).filter(
    (issue) => issue.field === 'name'
  )
)

const {
  update,
  updateDescription,
  updateToolConfig,
  updateTimeout,
  updateLauncherAfterRun,
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
  { id: 'copy', name: t('commands.afterRunCopy') },
  { id: 'none', name: t('settings.actionAfterRunNone') },
])

const selectionAfterRunOptions = computed(() => [
  { id: 'replaceSelection', name: t('commands.afterRunReplaceSelection') },
  ...afterRunOptions.value,
])

/**
 * What quick commands do with the output. A command without text never has a
 * selection to replace, so it shows the fallback of a replacement instead
 */
const launcherAction = computed(() => {
  const { action, fallback } = props.command.launcherAfterRun
  return !takesText.value && action === 'replaceSelection' ? fallback : action
})
/** Only then does a run without a selection need an action of its own */
const replacesSelection = computed(
  () => launcherAction.value === 'replaceSelection'
)

/**
 * Only quick-command runs configured to ignore output may stay in the
 * background.
 */
const backgroundScript = computed(
  () =>
    props.command.toolId === 'script' &&
    (launcherAction.value === 'none' ||
      (replacesSelection.value &&
        props.command.launcherAfterRun.fallback === 'none'))
)

/** Who added a default command and which tool it runs */
const origin = computed(() => {
  const owner = commandAddedBy(props.command, toolsStore)
  const label = tool.value ? toolLabel(tool.value, t) : props.command.toolId
  if (!owner) return t('commands.toolInfo', { tool: label })
  return owner.kind === 'plugin'
    ? t('commands.toolInfoPlugin', { tool: label, name: owner.name })
    : t('commands.toolInfoApp', { tool: label })
})

/** Shown open when one of its settings is set, so it is not missed */
const advancedOpen = ref(
  Boolean(props.command.description) ||
    Boolean(scriptConfig.value.timeoutSec) ||
    props.command.logOutput ||
    props.command.availableIn.external
)

/** By the name, which reads better, while it is unique; otherwise by the id */
const cliCommand = computed(() =>
  normalizeCommandName(props.command.name) && !props.nameConflicts.length
    ? commandCliCall(props.command.name.trim(), true)
    : commandCliCall(props.command.id)
)

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyCli() {
  try {
    await navigator.clipboard.writeText(cliCommand.value)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // clipboard access might be denied; the line stays selectable
  }
}

async function openLog() {
  const res = await ipcStore.callFunction('openActionLog', [])
  if (!res.success) toast('commands.openLogFailed', 'error')
  else if (!res.result) toast('commands.logEmpty')
}

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.command-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-lg, 1rem);
  width: 100%;
}

.command-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 0.25rem);
}

.command-field-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  font-size: var(--text-caption);
  font-weight: 500;
  color: var(--app-text-muted);
}

.command-required {
  color: var(--color-error);
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

.command-group-toggle {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  cursor: pointer;
  list-style: none;
}

.command-group-toggle::-webkit-details-marker {
  display: none;
}

.command-group-toggle svg {
  transition: transform var(--transition-fast);
}

details[open] > .command-group-toggle svg {
  transform: rotate(90deg);
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
