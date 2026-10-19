<template>
  <FastNoteTemplatePicker
    v-if="isFastNote"
    :field="tool.configFields?.find((field) => field.name === 'preset')"
    @apply="emit('patch', $event)"
  />
  <FieldRow
    v-for="field in visibleFields"
    :key="field.name"
    :group="field.type === 'sortable-checklist'"
    :label="fieldLabel(field)"
    vertical
    density="compact"
  >
    <ConfigFieldControl
      :control="controlFor(field)"
      auto-resize
      @update:model-value="updateField(field, $event)"
    />
    <FastNoteDirectoryPicker
      v-if="isFastNote && field.name === 'pathToNotes'"
      @select="emit('update', field.name, $event)"
    />
  </FieldRow>
  <FastNotePreview v-if="isFastNote" :config="effectiveConfig" />
  <p
    v-if="tool.owner.kind === 'plugin' && tool.configFields?.length"
    class="tool-field-hint"
  >
    {{ t('commands.pluginFieldsHint') }}
  </p>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  configFieldLabel,
  configOptionLabel,
} from '../../lib/config-fields/config-field-labels'
import { toolCallConfig } from '../../lib/tools/tool-input'
import type { RegisteredTool } from '../../lib/tools/tool-types'
import type { ConfigFieldControl as Control } from '../../lib/ui/config-field-control'
import type { InputConfigItem } from '../../types'
import FieldRow from '../common/FieldRow.vue'
import ConfigFieldControl from './ConfigFieldControl.vue'
import FastNoteDirectoryPicker from './FastNoteDirectoryPicker.vue'
import FastNotePreview from './FastNotePreview.vue'
import FastNoteTemplatePicker from './FastNoteTemplatePicker.vue'
import type { CommandConfig } from '@tyco/shared'

const props = defineProps<{ command: CommandConfig; tool: RegisteredTool }>()
const emit = defineEmits<{
  update: [field: string, value: unknown]
  patch: [values: Record<string, unknown>]
}>()
const { t } = useI18n()
const isFastNote = computed(() => props.tool.id === 'FastNote.write')
const effectiveConfig = computed(() =>
  toolCallConfig(props.tool, props.command.toolConfig)
)
const visibleFields = computed(() =>
  (props.tool.configFields ?? []).filter(
    (field) =>
      !isFastNote.value ||
      (field.name !== 'preset' &&
        (field.name !== 'customSubfolderTemplate' ||
          effectiveConfig.value.folderPreset === 'custom'))
  )
)
const stringValue = (name: string): string => {
  const value = props.command.toolConfig[name]
  return typeof value === 'string' ? value : ''
}

const fieldLabel = (field: InputConfigItem) => configFieldLabel(field, t)

const pluginSetting = (name: string): unknown => props.tool.baseConfig?.()[name]

const optionName = (field: InputConfigItem, id: unknown): string => {
  const option = field.options?.find((item) => item.id === id)
  if (!option) return String(id ?? '')
  return configOptionLabel(option, t)
}

/** What the plugin settings give for an empty field */
function inherited(field: InputConfigItem): string {
  const value = pluginSetting(field.name) ?? field.defaultValue
  return typeof value === 'string' && value
    ? t('commands.fromPluginSettings', { value })
    : ''
}

function selectOptions(field: InputConfigItem) {
  const fallback = pluginSetting(field.name) ?? field.defaultValue
  return [
    {
      id: '',
      name: t('commands.fromPluginSettings', {
        value: optionName(field, fallback),
      }),
    },
    ...(field.options ?? []).map((option) => ({
      id: String(option.id),
      name: optionName(field, option.id),
    })),
  ]
}

const checkboxValue = (name: string): string => {
  const value = props.command.toolConfig[name]
  return typeof value === 'boolean' ? String(value) : ''
}

function checkboxOptions(field: InputConfigItem) {
  const fallback = Boolean(pluginSetting(field.name) ?? field.defaultValue)
  return [
    {
      id: '',
      name: t('commands.fromPluginSettings', {
        value: t(fallback ? 'commands.fieldOn' : 'commands.fieldOff'),
      }),
    },
    { id: 'true', name: t('commands.fieldOn') },
    { id: 'false', name: t('commands.fieldOff') },
  ]
}

function controlFor(field: InputConfigItem): Control {
  if (field.type === 'checkbox')
    return {
      type: 'select',
      value: checkboxValue(field.name),
      options: checkboxOptions(field),
    }
  if (field.type === 'select')
    return {
      type: 'select',
      value: stringValue(field.name),
      options: selectOptions(field),
    }
  if (field.type === 'sortable-checklist')
    return {
      type: field.type,
      value: props.command.toolConfig[field.name],
      options: field.options,
      defaultValue: pluginSetting(field.name) ?? field.defaultValue,
    }
  return {
    type: field.type,
    value: stringValue(field.name),
    placeholder: inherited(field),
  }
}

function updateField(field: InputConfigItem, value: unknown) {
  emit(
    'update',
    field.name,
    field.type === 'checkbox'
      ? value === ''
        ? undefined
        : value === 'true'
      : value
  )
}
</script>
<style scoped>
.tool-field-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
