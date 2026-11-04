<template>
  <FieldRow
    vertical
    density="compact"
    :label="t('commands.promptLabel')"
    :info="t('commands.promptInfo')"
    :warning="warnings"
  >
    <FieldPromptTextArea
      :model-value="prompt"
      :placeholder="t('commands.promptPlaceholder')"
      :modal-title="t('commands.promptLabel')"
      auto-resize
      @update:model-value="emit('update', 'prompt', $event)"
    />
  </FieldRow>
  <FieldRow
    v-if="ruleOptions.length"
    vertical
    density="compact"
    :label="t('commands.promptFromTask')"
  >
    <FieldSelect
      model-value=""
      :options="[
        { id: '', name: t('commands.promptFromTaskPlaceholder') },
        ...ruleOptions,
      ]"
      @update:model-value="takeRule"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { toolConfigText } from '../../lib/commands/command-config'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  userConfig?: UserConfig
  warnings: string[]
}>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const prompt = computed(() => toolConfigText(props.command, 'prompt'))
/** The library of the tool: transformations or styles */
const sourceItems = computed(() =>
  props.command.toolId === 'core.styling'
    ? (props.userConfig?.styling.items ?? [])
    : (props.userConfig?.transformations.items ?? [])
)
const ruleOptions = computed(() =>
  sourceItems.value.flatMap((item, index) =>
    item.rule.trim()
      ? [{ id: item.id, name: item.name || `#${index + 1}` }]
      : []
  )
)

/** The rule is copied: the command keeps it when the library item changes */
function takeRule(value: string | number | undefined) {
  const item =
    typeof value === 'string'
      ? sourceItems.value.find((entry) => entry.id === value)
      : undefined
  if (item) emit('update', 'prompt', item.rule)
}
</script>
