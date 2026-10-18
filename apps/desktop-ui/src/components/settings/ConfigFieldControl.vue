<template>
  <FieldInput
    v-if="control.type === 'text'"
    :model-value="control.value"
    :placeholder="control.placeholder"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <FieldTextArea
    v-else-if="control.type === 'textarea'"
    :model-value="control.value"
    :placeholder="control.placeholder"
    :auto-resize="autoResize"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <FieldSelect
    v-else-if="control.type === 'select'"
    class="w-full"
    :model-value="control.value"
    :options="control.options"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <FieldCheckbox
    v-else-if="control.type === 'checkbox'"
    :model-value="control.value"
    @update:model-value="emit('update:modelValue', $event)"
  />
  <FieldSortableChecklist
    v-else-if="control.type === 'sortable-checklist'"
    :model-value="control.value"
    :options="control.options"
    :default-value="control.defaultValue"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
<script setup lang="ts">
import type { ConfigFieldControl } from '../../lib/ui/config-field-control'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSortableChecklist from '../common/FieldSortableChecklist.vue'
import FieldTextArea from '../common/FieldTextArea.vue'

defineProps<{ control: ConfigFieldControl; autoResize?: boolean }>()
const emit = defineEmits<{ 'update:modelValue': [value: unknown] }>()
</script>
