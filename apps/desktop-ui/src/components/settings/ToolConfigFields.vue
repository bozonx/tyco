<template>
  <div class="tool-config-fields">
    <template v-if="command.toolId === 'core.translate'">
      <div class="tool-field">
        <span class="tool-field-label">
          {{ t('commands.languageLabel') }}
          <InfoTooltip :text="t('commands.languageInfo')" />
        </span>
        <FieldSelect
          :value="stringValue('language')"
          :options="languageOptions"
          @update:value="emit('update', 'language', $event ?? '')"
        />
        <FieldIssues :issues="issuesOf('language')" />
      </div>
    </template>

    <template v-else-if="command.toolId === 'core.aiTask'">
      <div class="tool-field">
        <span class="tool-field-label">
          {{ t('commands.promptLabel') }}
          <InfoTooltip :text="t('commands.promptInfo')" />
        </span>
        <FieldTextArea
          :value="stringValue('prompt')"
          :placeholder="t('commands.promptPlaceholder')"
          auto-resize
          @update:value="emit('update', 'prompt', $event)"
        />
        <FieldIssues :issues="issuesOf('prompt')" />
      </div>
      <div v-if="aiTaskOptions.length" class="tool-field">
        <span class="tool-field-label">{{ t('commands.promptFromTask') }}</span>
        <FieldSelect
          value=""
          :options="[
            { id: '', name: t('commands.promptFromTaskPlaceholder') },
            ...aiTaskOptions,
          ]"
          @update:value="takeTaskRule"
        />
      </div>
    </template>

    <template v-else>
      <div
        v-for="field in tool.configFields ?? []"
        :key="field.name"
        class="tool-field"
      >
        <span class="tool-field-label">{{ fieldLabel(field) }}</span>
        <FieldInput
          v-if="field.type === 'text'"
          :value="stringValue(field.name)"
          :placeholder="inherited(field)"
          @update:value="emit('update', field.name, $event)"
        />
        <FieldTextArea
          v-else-if="field.type === 'textarea'"
          :value="stringValue(field.name)"
          :placeholder="inherited(field)"
          auto-resize
          @update:value="emit('update', field.name, $event)"
        />
        <FieldSelect
          v-else-if="field.type === 'select'"
          :value="stringValue(field.name)"
          :options="selectOptions(field)"
          @update:value="emit('update', field.name, $event ?? '')"
        />
        <FieldSelect
          v-else-if="field.type === 'checkbox'"
          :value="checkboxValue(field.name)"
          :options="checkboxOptions(field)"
          @update:value="updateCheckbox(field.name, $event)"
        />
      </div>
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

import { useI18n } from '../../composables/useI18n'
import { validateCommand } from '../../lib/commands/command-config'
import { buildLanguageOptions } from '../../lib/locale/language'
import type { RegisteredTool } from '../../lib/tools/tool-types'
import { useToolsStore } from '../../stores/tools'
import type { InputConfigItem } from '../../types'
import FieldInput from '../common/FieldInput.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InfoTooltip from '../common/InfoTooltip.vue'
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
  const slots = (props.userConfig?.toTranslateLanguages ?? []).filter(
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

const fieldLabel = (field: InputConfigItem) =>
  field.labelKey ? t(field.labelKey) : field.label || field.name

const pluginSetting = (name: string): unknown => props.tool.baseConfig?.()[name]

const optionName = (field: InputConfigItem, id: unknown): string => {
  const option = field.options?.find((item) => item.id === id)
  if (!option) return String(id ?? '')
  return option.labelKey ? t(option.labelKey) : option.name || String(option.id)
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

function updateCheckbox(name: string, value: string | number | undefined) {
  emit('update', name, value === '' ? undefined : value === 'true')
}
</script>

<style scoped>
.tool-config-fields {
  display: flex;
  flex-direction: column;
  gap: var(--space-md, 0.75rem);
  width: 100%;
}

.tool-field {
  display: flex;
  flex-direction: column;
  gap: var(--space-xs, 0.25rem);
}

.tool-field-label {
  display: inline-flex;
  align-items: center;
  gap: var(--space-xs, 0.25rem);
  font-size: 0.75rem;
  font-weight: 500;
  color: var(--app-text-muted);
}

.tool-field-hint {
  font-size: 0.75rem;
  color: var(--app-text-muted);
}
</style>
