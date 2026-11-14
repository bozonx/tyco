<template>
  <div class="tool-config-fields">
    <AiCommandOperationFields
      v-if="command.operationId === 'core.aiTask'"
      :command="command"
      :user-config="userConfig"
      :warnings="warningsOf('prompt')"
      @update="update"
    />
    <PluginOperationFields
      v-else
      :command="command"
      :tool="tool"
      @update="update"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { validateCommand } from '../../lib/commands/command-runtime'
import type { RegisteredOperation } from '../../lib/operations/operation-types'
import { useOperationsStore } from '../../stores/operations'
import AiCommandOperationFields from './AiCommandOperationFields.vue'
import PluginOperationFields from './PluginOperationFields.vue'
import {
  type CommandConfig,
  ACTION_TEXT_PLACEHOLDER as TEXT,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  tool: RegisteredOperation
  userConfig?: UserConfig
}>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
const operationsStore = useOperationsStore()
const issues = computed(() => validateCommand(props.command, operationsStore))
const warningsOf = (field: string) =>
  issues.value
    .filter((issue) => issue.field === field)
    .map((issue) => t(issue.messageKey, { placeholder: TEXT }))
function update(field: string, value: unknown) {
  emit('update', field, value)
}
</script>
<style scoped>
.tool-config-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md);
  width: 100%;
}
</style>
