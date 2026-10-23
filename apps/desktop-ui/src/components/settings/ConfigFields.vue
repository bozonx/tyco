<template>
  <div class="ui-form-container">
    <FieldRow
      v-for="item in fields"
      :key="item.name"
      :group="item.type === 'sortable-checklist'"
      :label="configFieldLabel(item, t)"
      :info="configFieldInfo(item, t)"
      :vertical="item.vertical ?? item.type === 'sortable-checklist'"
    >
      <ConfigFieldControl
        :control="controlFor(item)"
        @update:model-value="updateValue(item.name, $event)"
      />
    </FieldRow>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  configFieldInfo,
  configFieldLabel,
  configFieldOptions,
} from '../../lib/config-fields/config-field-labels'
import type { ConfigFieldControl as Control } from '../../lib/ui/config-field-control'
import FieldRow from '../common/FieldRow.vue'
import ConfigFieldControl from './ConfigFieldControl.vue'
import type { InputConfigItem } from '@/types'
import { withConfigFieldValue } from '@tyco/plugin-sdk'

const props = defineProps<{ config: InputConfigItem[] }>()

const emit = defineEmits<{
  (e: 'update:values', values: Record<string, unknown>): void
}>()

const { t } = useI18n()
const fields = computed(() =>
  props.config.map((field) =>
    withConfigFieldValue(field, values.value[field.name])
  )
)
const values = ref<Record<string, unknown>>({})

watch(
  () => props.config,
  (newConfig) => {
    const nextValues: Record<string, unknown> = {}
    for (const item of newConfig) {
      if (item.value !== undefined) {
        nextValues[item.name] = withConfigFieldValue(item, item.value).value
      } else {
        nextValues[item.name] = withConfigFieldValue(
          item,
          item.defaultValue
        ).value
      }
    }
    values.value = nextValues
  },
  { immediate: true, deep: true }
)

function controlFor(item: InputConfigItem): Control {
  if (item.type === 'select')
    return {
      type: 'select',
      value: item.value,
      options: configFieldOptions(item, t),
    }
  if (item.type === 'checkbox') return { type: 'checkbox', value: item.value }
  if (item.type === 'sortable-checklist')
    return {
      type: item.type,
      value: item.value,
      options: item.options,
      defaultValue: item.defaultValue,
    }
  return {
    type: item.type,
    value: item.value === undefined ? undefined : String(item.value),
  }
}

function updateValue(name: string, value: unknown) {
  const field = props.config.find((item) => item.name === name)
  if (!field) return
  values.value[name] = withConfigFieldValue(field, value).value
  emit('update:values', { ...values.value })
}
</script>
