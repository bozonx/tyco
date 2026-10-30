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
import { toolConfigText } from '../../lib/commands/command-config'
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
const prompt = computed(() => toolConfigText(props.command, 'prompt'))
const sourceItems = computed(
  (): { id: string; name: string; prompt: string }[] => {
    if (props.command.toolId === 'core.transformation')
      return (props.userConfig?.transformations.items ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        prompt: item.rule,
      }))
    if (props.command.toolId === 'core.styling')
      return (props.userConfig?.styling.items ?? []).map((item) => ({
        id: item.id,
        name: item.name,
        prompt: item.rule,
      }))
    return props.userConfig?.aiTasks.items ?? []
  }
)
const aiTaskOptions = computed(() =>
  sourceItems.value.flatMap((task, index) =>
    task.prompt.trim()
      ? [{ id: task.id, name: task.name || `#${index + 1}` }]
      : []
  )
)

/** The rule is copied: the command keeps it when the task changes */
function takeTaskRule(value: string | number | undefined) {
  const task =
    typeof value === 'string'
      ? sourceItems.value.find((item) => item.id === value)
      : undefined
  if (task) emit('update', 'prompt', task.prompt)
}
</script>
