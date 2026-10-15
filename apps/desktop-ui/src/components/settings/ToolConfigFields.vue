<template>
  <div class="tool-config-fields">
    <template v-if="command.toolId === 'core.translate'">
      <FieldRow
        vertical
        density="compact"
        :label="t('commands.languageLabel')"
        :info="t('commands.languageInfo')"
      >
        <FieldSelect
          :model-value="stringValue('language')"
          :options="languageOptions"
          @update:model-value="emit('update', 'language', $event ?? '')"
        />
        <template #messages
          ><FieldIssues :issues="issuesOf('language')"
        /></template>
      </FieldRow>
    </template>

    <template v-else-if="command.toolId === 'core.aiTask'">
      <FieldRow
        vertical
        density="compact"
        :label="t('commands.promptLabel')"
        :info="t('commands.promptInfo')"
      >
        <FieldTextArea
          :model-value="stringValue('prompt')"
          :placeholder="t('commands.promptPlaceholder')"
          auto-resize
          @update:model-value="emit('update', 'prompt', $event)"
        />
        <template #messages
          ><FieldIssues :issues="issuesOf('prompt')"
        /></template>
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

    <template v-else>
      <FieldRow
        v-for="field in tool.configFields ?? []"
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
      </FieldRow>
      <p
        v-if="tool.owner.kind === 'plugin' && tool.configFields?.length"
        class="tool-field-hint"
      >
        {{ t('commands.pluginFieldsHint') }}
      </p>
    </template>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { validateCommand } from '../../lib/commands/command-runtime'
import {
  configFieldLabel,
  configOptionLabel,
} from '../../lib/config-fields/config-field-labels'
import { buildLanguageOptions } from '../../lib/locale/language'
import type { RegisteredTool } from '../../lib/tools/tool-types'
import type { ConfigFieldControl as Control } from '../../lib/ui/config-field-control'
import { useToolsStore } from '../../stores/tools'
import type { InputConfigItem } from '../../types'
import ConfigFieldControl from '../common/ConfigFieldControl.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import FieldIssues from './FieldIssues.vue'
import type { CommandConfig, UserConfig } from '@tyco/shared'

/**
 * The settings of a tool other than a script or a webhook: the language of a
 * translation, the instruction of an AI task, or the fields a plugin declares.
 * An empty plugin field falls back to the plugin settings
 */
const props = defineProps<{
  command: CommandConfig
  tool: RegisteredTool
  userConfig?: UserConfig
}>()

const emit = defineEmits<{
  /** A field of the tool config changed; `undefined` clears it */
  (event: 'update', field: string, value: unknown): void
}>()

const { t } = useI18n()
const toolsStore = useToolsStore()

const issues = computed(() => validateCommand(props.command, toolsStore))
const issuesOf = (field: string) =>
  issues.value.filter((issue) => issue.field === field)

const stringValue = (name: string): string => {
  const value = props.command.toolConfig[name]
  return typeof value === 'string' ? value : ''
}

const languageOptions = computed(() => {
  const slots = (props.userConfig?.translation.targetLanguages ?? []).filter(
    (language): language is string => Boolean(language)
  )
  const options = buildLanguageOptions(
    [...slots, stringValue('language')],
    false,
    t
  )
  // the languages of the translation slots come first
  const slotOptions = slots.flatMap(
    (language) => options.find((option) => option.id === language) ?? []
  )
  return [
    { id: '', name: t('commands.languagePlaceholder') },
    ...slotOptions,
    ...options.filter((option) => !slots.includes(option.id)),
  ]
})

const aiTaskOptions = computed(() =>
  (props.userConfig?.aiTasks ?? []).flatMap((task, index) =>
    task?.rule.trim()
      ? [{ id: String(index), name: task.name || `#${index + 1}` }]
      : []
  )
)

/** The rule is copied: the command keeps it when the task changes */
function takeTaskRule(value: string | number | undefined) {
  const task = props.userConfig?.aiTasks?.[Number(value)]
  if (value !== '' && task) emit('update', 'prompt', task.rule)
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
.tool-config-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
  width: 100%;
}

.tool-field-hint {
  font-size: var(--text-caption);
  color: var(--app-text-muted);
}
</style>
