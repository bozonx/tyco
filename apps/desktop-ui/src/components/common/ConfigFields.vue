<template>
  <div class="ui-form-container">
    <FieldRow
      v-for="item in fields"
      :key="item.name"
      :label="configFieldLabel(item, t)"
      :vertical="item.vertical ?? item.type === 'sortable-checklist'"
    >
      <FieldInput
        v-if="item.type === 'text'"
        :value="item.value"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldTextArea
        v-else-if="item.type === 'textarea'"
        :value="item.value"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldSelect
        v-else-if="item.type === 'select'"
        class="w-full"
        :value="item.value"
        :options="configFieldOptions(item, t)"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldCheckbox
        v-else-if="item.type === 'checkbox'"
        :key="item.name"
        :value="item.value ?? false"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldSortableChecklist
        v-else-if="item.type === 'sortable-checklist'"
        :value="item.value"
        :options="item.options || []"
        :default-value="item.defaultValue"
        @update:value="updateValue(item.name, $event)"
      />
    </FieldRow>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import {
  configFieldLabel,
  configFieldOptions,
} from '../../lib/config-fields/config-field-labels'
import FieldCheckbox from './FieldCheckbox.vue'
import FieldInput from './FieldInput.vue'
import FieldRow from './FieldRow.vue'
import FieldSelect from './FieldSelect.vue'
import FieldSortableChecklist from './FieldSortableChecklist.vue'
import FieldTextArea from './FieldTextArea.vue'
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

function updateValue(name: string, value: unknown) {
  const field = props.config.find((item) => item.name === name)
  if (!field) return
  values.value[name] = withConfigFieldValue(field, value).value
  emit('update:values', { ...values.value })
}
</script>
