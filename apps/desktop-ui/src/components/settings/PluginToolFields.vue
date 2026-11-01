<template>
  <FieldRow
    v-for="field in visibleFields"
    :key="field.name"
    :group="field.type === 'sortable-checklist'"
    :label="fieldLabel(field)"
    :info="fieldInfo(field)"
    vertical
    density="compact"
  >
    <template v-if="field.name === tool.directoryFieldName" #info>
      <DeviceScopeBadge />
    </template>
    <ConfigFieldControl
      :control="controlFor(field)"
      auto-resize
      @update:model-value="updateField(field, $event)"
    />
    <DirectoryPickerButton
      v-if="field.name === tool.directoryFieldName"
      @select="emit('update', field.name, $event)"
    />
  </FieldRow>
  <ToolConfigPreview
    v-if="tool.previewConfig"
    :tool="tool"
    :config="effectiveConfig"
  />
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
  configFieldInfo,
  configFieldLabel,
  configOptionLabel,
} from '../../lib/config-fields/config-field-labels'
import { toolCallConfig } from '../../lib/tools/tool-input'
import type { RegisteredTool } from '../../lib/tools/tool-types'
import type { ConfigFieldControl as Control } from '../../lib/ui/config-field-control'
import type { InputConfigItem } from '../../types'
import FieldRow from '../common/FieldRow.vue'
import ConfigFieldControl from './ConfigFieldControl.vue'
import DeviceScopeBadge from './DeviceScopeBadge.vue'
import DirectoryPickerButton from './DirectoryPickerButton.vue'
import ToolConfigPreview from './ToolConfigPreview.vue'
import { isConfigFieldVisible } from '@tyco/plugin-sdk'
import type { CommandConfig } from '@tyco/shared'

const props = defineProps<{ command: CommandConfig; tool: RegisteredTool }>()
const emit = defineEmits<{ update: [field: string, value: unknown] }>()
const { t } = useI18n()
/** What a run of the command gets: its settings over the plugin settings */
const effectiveConfig = computed(() =>
  toolCallConfig(props.tool, props.command.toolConfig)
)
const visibleFields = computed(() =>
  (props.tool.configFields ?? []).filter((field) =>
    isConfigFieldVisible(field, effectiveConfig.value)
  )
)
const stringValue = (name: string): string => {
  const value = props.command.toolConfig[name]
  return typeof value === 'string' ? value : ''
}

const fieldLabel = (field: InputConfigItem) => configFieldLabel(field, t)
const fieldInfo = (field: InputConfigItem) => configFieldInfo(field, t)

/**
 * What an empty field of the command falls back to: the plugin settings, or the
 * values of a preset the command selects
 */
const pluginSetting = (name: string): unknown => {
  const { [name]: _own, ...rest } = props.command.toolConfig
  return toolCallConfig(props.tool, rest)[name]
}

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
