<template>
  <FieldRow
    vertical
    density="compact"
    :label="t('commands.promptLabel')"
    :info="t('commands.promptInfo')"
    :warning="warnings"
  >
    <FieldTextArea
      :model-value="prompt"
      :placeholder="t('commands.promptPlaceholder')"
      auto-resize
      @update:model-value="emit('update', 'prompt', $event)"
    />
  </FieldRow>
  <FieldRow
    v-if="aiTaskOptions.length"
    vertical
    density="compact"
    :label="t('commands.promptFromTask')"
  >
    <FieldSelect
      model-value=""
      :options="[
        { id: '', name: t('commands.promptFromTaskPlaceholder') },
        ...aiTaskOptions,
      ]"
      @update:model-value="takeTaskRule"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { findAiTask } from '../../lib/ai-tasks/ai-task-library'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig?: UserConfig
  warnings: string[]
}>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const prompt = computed(() =>
  typeof props.command.toolConfig.prompt === 'string'
    ? props.command.toolConfig.prompt
    : ''
)
const aiTaskOptions = computed(() =>
  (props.userConfig?.aiTasks ?? []).flatMap((task, index) =>
    task.rule.trim()
      ? [{ id: task.id, name: task.name || `#${index + 1}` }]
      : []
  )
)

/** The rule is copied: the command keeps it when the task changes */
function takeTaskRule(value: string | number | undefined) {
  const task =
    typeof value === 'string'
      ? findAiTask(props.userConfig?.aiTasks, value)
      : undefined
  if (task) emit('update', 'prompt', task.rule)
}
</script>
