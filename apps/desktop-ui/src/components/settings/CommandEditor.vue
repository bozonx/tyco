<template>
  <div class="command-editor">
    <label class="command-field">
      <span class="command-field-label">{{ t('commands.nameLabel') }}</span>
      <FieldInput
        :value="command.name"
        :placeholder="t('commands.namePlaceholder')"
        @update:value="update({ name: $event })"
      />
    </label>

    <label class="command-field">
      <span class="command-field-label">
        {{ t('commands.descriptionLabel') }}
        <InfoTooltip :text="t('commands.descriptionInfo')" />
      </span>
      <FieldInput
        :value="command.description ?? ''"
        :placeholder="t('commands.descriptionPlaceholder')"
        @update:value="updateDescription"
      />
    </label>

    <div class="command-field">
      <span class="command-field-label">
        {{ t('commands.idLabel') }}
        <InfoTooltip :text="t('commands.idInfo')" />
      </span>
      <div class="command-field-row">
        <code class="command-id" :title="command.id">{{ command.id }}</code>
        <Button
          type="button"
          ghost
          square
          sm
          :title="copied ? t('commands.idCopied') : t('commands.copyId')"
          @click="copyId"
        >
          <Icon
            :icon="copied ? 'mdi:check' : 'mdi:content-copy'"
            width="16"
            height="16"
          />
        </Button>
      </div>
    </div>

    <div class="command-field-row">
      <FieldCheckbox
        :value="command.enabled"
        :label="t('commands.enabled')"
        @update:value="update({ enabled: $event })"
      />
    </div>

    <div class="command-field">
      <span class="command-field-label">{{ t('commands.toolLabel') }}</span>
      <div class="command-tool">
        <Icon
          :icon="tool?.icon ?? 'mdi:puzzle-outline'"
          width="16"
          height="16"
        />
        <span>{{ tool ? toolLabel(tool, t) : command.toolId }}</span>
      </div>
      <p v-if="unavailable" class="command-warning">
        {{ t(unavailable) }}
      </p>
    </div>

    <div v-if="customActionTool" class="command-field-row">
      <FieldCheckbox
        :value="takesText"
        :label="t('commands.takesText')"
        @update:value="updateToolConfig('takesText', $event)"
      />
      <InfoTooltip :text="t('commands.takesTextInfo')" />
    </div>
    <p v-if="inMenu && tool && !takesText" class="command-warning">
      {{ t('commands.warningMenuNeedsText') }}
    </p>

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

    <div class="command-field">
      <span class="command-field-label">
        {{ t('settings.actionAfterRunLabel') }}
        <InfoTooltip :text="t('commands.afterRunInfo')" />
      </span>
      <SegmentedControl
        :value="command.afterRun"
        :label="t('settings.actionAfterRunLabel')"
        :options="[
          { id: 'none', name: t('settings.actionAfterRunNone') },
          { id: 'showMenu', name: t('settings.actionAfterRunShowMenu') },
          {
            id: 'replaceSelection',
            name: t('commands.afterRunReplaceSelection'),
          },
          { id: 'copy', name: t('commands.afterRunCopy') },
        ]"
        @update:value="update({ afterRun: $event as CustomActionAfterRun })"
      />
    </div>

    <div class="command-field-row">
      <FieldCheckbox
        :value="command.availableIn.external"
        :label="t('commands.external')"
        @update:value="
          update({ availableIn: { ...command.availableIn, external: $event } })
        "
      />
      <InfoTooltip :text="t('commands.externalInfo')" />
    </div>
    <p v-if="nameTwins.length" class="command-warning">
      {{
        t('commands.warningExternalNameTwins', {
          names: nameTwins.map(commandLabel).join(', '),
        })
      }}
    </p>

    <div class="command-field-row">
      <FieldCheckbox
        :value="command.confirm === 'always'"
        :label="t('commands.confirm')"
        @update:value="update({ confirm: $event ? 'always' : 'auto' })"
      />
      <InfoTooltip :text="t('commands.confirmInfo')" />
    </div>

    <div class="command-field-row">
      <FieldCheckbox
        :value="command.logOutput"
        :label="t('settings.actionLogOutput')"
        @update:value="update({ logOutput: $event })"
      />
      <InfoTooltip :text="t('settings.actionLogOutputInfo')" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onUnmounted, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import {
  commandLabel,
  commandTakesText,
  commandTool,
  commandUnavailableReason,
} from '../../lib/commands/command-config'
import { toolLabel } from '../../lib/tools/tool-label'
import { useToolsStore } from '../../stores/tools'
import Button from '../common/Button.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import CustomActionFields from './CustomActionFields.vue'
import ToolConfigFields from './ToolConfigFields.vue'
import { Icon } from '@iconify/vue'
import type {
  CommandConfig,
  CustomActionAfterRun,
  UserConfig,
} from '@tyco/shared'

const props = withDefaults(
  defineProps<{
    command: CommandConfig
    /** The command is an item of the action menu */
    inMenu?: boolean
    /** Other commands an external call by this name could mean */
    nameTwins?: CommandConfig[]
    /** For the settings of the tool: translation languages, AI tasks */
    userConfig?: UserConfig
  }>(),
  { inMenu: false, nameTwins: () => [] }
)

const emit = defineEmits<{ (event: 'update', command: CommandConfig): void }>()

const { t } = useI18n()

const toolsStore = useToolsStore()
const tool = computed(() => commandTool(props.command, toolsStore))
/** A script or a webhook: its settings have an editor of their own */
const customActionTool = computed(
  () => props.command.toolId === 'script' || props.command.toolId === 'webhook'
)
const takesText = computed(() => commandTakesText(props.command, toolsStore))
/** Why the command cannot run, unless its tool is missing altogether */
const unavailable = computed(() =>
  tool.value ? commandUnavailableReason(props.command, toolsStore) : undefined
)

function update(patch: Partial<CommandConfig>) {
  emit('update', { ...props.command, ...patch })
}

function updateDescription(value: string) {
  const { description: _previous, ...rest } = props.command
  emit('update', value.trim() ? { ...rest, description: value } : rest)
}

function updateToolConfig(field: string, value: unknown) {
  const { [field]: _previous, ...rest } = props.command.toolConfig
  update({
    toolConfig: value === undefined ? rest : { ...rest, [field]: value },
  })
}

const copied = ref(false)
let copiedTimer: ReturnType<typeof setTimeout> | null = null

async function copyId() {
  try {
    await navigator.clipboard.writeText(props.command.id)
    copied.value = true
    if (copiedTimer) clearTimeout(copiedTimer)
    copiedTimer = setTimeout(() => {
      copied.value = false
    }, 2000)
  } catch {
    // clipboard access might be denied; the id stays selectable
  }
}

onUnmounted(() => {
  if (copiedTimer) clearTimeout(copiedTimer)
})
</script>

<style scoped>
.command-editor {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
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
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--app-text-muted);
}

.command-tool {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  font-size: 0.875rem;
}

.command-field-row {
  display: flex;
  align-items: center;
  gap: var(--space-sm, 0.5rem);
  width: 100%;
}

.command-id {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 0.75rem;
  color: var(--app-text-muted);
  user-select: all;
}

.command-warning {
  font-size: 0.75rem;
  color: var(--color-warning);
}
</style>
