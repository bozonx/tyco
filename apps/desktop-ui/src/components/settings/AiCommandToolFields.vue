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
    :label="t('commands.aiAllowedCommands')"
    :info="t('commands.aiAllowedCommandsInfo')"
  >
    <div v-if="candidates.length" class="ai-command-list">
      <FieldCheckbox
        v-for="item in candidates"
        :key="item.id"
        :model-value="config.allowedCommandIds.includes(item.id)"
        :label="item.name"
        @update:model-value="toggleCommand(item.id, $event)"
      />
    </div>
    <p v-else class="ai-command-empty">
      {{ t('commands.aiNoOtherCommands') }}
    </p>
  </FieldRow>
  <FieldRow
    v-if="config.allowedCommandIds.length"
    :label="t('commands.aiMaxSteps')"
    :info="t('commands.aiMaxStepsInfo')"
  >
    <FieldNumber
      min="1"
      :max="AI_COMMAND_MAX_STEPS_MAX"
      :model-value="config.maxSteps"
      @update:model-value="setMaxSteps"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  aiCommandToolConfigOf,
  callableCommands,
} from '../../lib/ai-commands/ai-command-config'
import { normalizeCommands } from '../../lib/commands/command-config'
import { commandLabel } from '../../lib/commands/command-runtime'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import VariableInsertMenu from './VariableInsertMenu.vue'
import VariableReferenceHints from './VariableReferenceHints.vue'
import {
  AI_COMMAND_MAX_STEPS_MAX,
  type CommandConfig,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig?: UserConfig
  warnings: string[]
}>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()

const config = computed(() => aiCommandToolConfigOf(props.command.toolConfig))

/** The commands the agent may be allowed to run: any but this one */
const candidates = computed(() =>
  callableCommands(
    props.command,
    normalizeCommands(props.userConfig?.commands)
  ).map((command) => ({ id: command.id, name: commandLabel(command) }))
)

function toggleCommand(id: string, isAllowed: boolean) {
  const others = config.value.allowedCommandIds.filter((item) => item !== id)
  emit('update', 'allowedCommandIds', isAllowed ? [...others, id] : others)
}

/** A number out of range or half typed is not taken */
function setMaxSteps(text: string) {
  const steps = Number(text)
  if (
    text.trim() &&
    Number.isInteger(steps) &&
    steps >= 1 &&
    steps <= AI_COMMAND_MAX_STEPS_MAX
  )
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

.ai-command-empty {
  margin: 0;
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
