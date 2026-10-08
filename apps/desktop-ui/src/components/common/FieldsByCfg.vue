<template>
  <div>
    <FieldRow
      v-for="item in config"
      :key="item.name"
      :label="item.labelKey ? t(item.labelKey) : item.label || item.name"
      :vertical="item.vertical ?? item.type === 'sortable-checklist'"
    >
      <FieldInput
        v-if="item.type === 'text'"
        :value="values[item.name]"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldTextArea
        v-else-if="item.type === 'textarea'"
        :value="values[item.name]"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldSelect
        v-else-if="item.type === 'select'"
        class="w-full"
        :value="values[item.name]"
        :options="mapOptions(item)"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldCheckbox
        v-else-if="item.type === 'checkbox'"
        :value="values[item.name]"
        @update:value="updateValue(item.name, $event)"
      />
      <FieldSortableChecklist
        v-else-if="item.type === 'sortable-checklist'"
        :value="values[item.name]"
        :options="item.options || []"
        :default-value="item.defaultValue"
        @update:value="updateValue(item.name, $event)"
      />
    </FieldRow>
  </div>
</template>

<script setup lang="ts">
import { computed, ref, watch } from 'vue'

import { useI18n } from '../../composables/useI18n'
import FieldCheckbox from './FieldCheckbox.vue'
import FieldInput from './FieldInput.vue'
import FieldRow from './FieldRow.vue'
import FieldSelect from './FieldSelect.vue'
import FieldSortableChecklist from './FieldSortableChecklist.vue'
import FieldTextArea from './FieldTextArea.vue'
import type { InputConfigItem } from '@/types'

const props = defineProps<{ config: InputConfigItem[] }>()

const emit = defineEmits<{
  (e: 'update:values', values: Record<string, any>): void
}>()

const { t } = useI18n()
const config = computed(() => props.config)
const values = ref<Record<string, any>>({})

watch(
  () => props.config,
  (newConfig) => {
    for (const item of newConfig) {
      if (item.value !== undefined) {
        values.value[item.name] = item.value
      } else if (values.value[item.name] === undefined) {
        values.value[item.name] = item.defaultValue
      }
    }
  },
  { immediate: true, deep: true }
)

function mapOptions(item: InputConfigItem) {
  return (item.options || []).map((opt) => ({
    id: opt.id,
    name: opt.labelKey ? t(opt.labelKey) : opt.name || String(opt.id),
  }))
}

function updateValue(name: string, value: any) {
  values.value[name] = value
  emit('update:values', { ...values.value })
}
</script>
