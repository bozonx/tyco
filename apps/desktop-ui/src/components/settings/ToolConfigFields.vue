<template>
  <div class="tool-config-fields">
    <TranslationToolFields
      v-if="command.toolId === 'core.translate'"
      :command="command"
      :user-config="userConfig"
      :warnings="warningsOf('language')"
      @update="update"
    />
    <AiTaskToolFields
      v-else-if="command.toolId === 'core.aiTask'"
      :command="command"
      :user-config="userConfig"
      :warnings="warningsOf('prompt')"
      @update="update"
    />
    <PluginToolFields
      v-else
      :command="command"
      :tool="tool"
      @update="update"
      @patch="emit('patch', $event)"
    />
  </div>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { validateCommand } from '../../lib/commands/command-runtime'
import type { RegisteredTool } from '../../lib/tools/tool-types'
import { useToolsStore } from '../../stores/tools'
import AiTaskToolFields from './AiTaskToolFields.vue'
import PluginToolFields from './PluginToolFields.vue'
import TranslationToolFields from './TranslationToolFields.vue'
import {
  type CommandConfig,
  ACTION_TEXT_PLACEHOLDER as TEXT,
  type UserConfig,
} from '@tyco/shared'

const props = defineProps<{
  command: CommandConfig
  tool: RegisteredTool
  userConfig?: UserConfig
}>()
const emit = defineEmits<{
  update: [field: string, value: unknown]
  patch: [values: Record<string, unknown>]
}>()
const { t } = useI18n()
const toolsStore = useToolsStore()
const issues = computed(() => validateCommand(props.command, toolsStore))
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
