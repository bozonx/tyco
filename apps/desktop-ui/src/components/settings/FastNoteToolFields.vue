<template>
  <PluginToolFields
    :command="command"
    :tool="tool"
    :excluded-fields="excludedFields"
    @update="(field, value) => emit('update', field, value)"
  >
    <template #before>
      <FastNoteTemplatePicker
        :field="tool.configFields?.find((field) => field.name === 'preset')"
        @apply="emit('patch', $event)"
      />
    </template>
    <template #field="{ field }">
      <FastNoteDirectoryPicker
        v-if="field.name === 'pathToNotes'"
        @select="emit('update', field.name, $event)"
      />
    </template>
    <template #after><FastNotePreview :config="effectiveConfig" /></template>
  </PluginToolFields>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { toolCallConfig } from '../../lib/tools/tool-input'
import type { RegisteredTool } from '../../lib/tools/tool-types'
import FastNoteDirectoryPicker from './FastNoteDirectoryPicker.vue'
import FastNotePreview from './FastNotePreview.vue'
import FastNoteTemplatePicker from './FastNoteTemplatePicker.vue'
import PluginToolFields from './PluginToolFields.vue'
import type { CommandConfig } from '@tyco/shared'

const props = defineProps<{ command: CommandConfig; tool: RegisteredTool }>()
const emit = defineEmits<{
  update: [field: string, value: unknown]
  patch: [values: Record<string, unknown>]
}>()
const effectiveConfig = computed(() =>
  toolCallConfig(props.tool, props.command.toolConfig)
)
const excludedFields = computed(() => [
  'preset',
  ...(effectiveConfig.value.folderPreset === 'custom'
    ? []
    : ['customSubfolderTemplate']),
])
</script>
