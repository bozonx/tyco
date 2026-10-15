<template>
  <label
    :class="$attrs.class"
    :style="$attrs.style"
    class="field-checkbox"
    :title="title"
  >
    <input
      v-bind="controlAttrs()"
      type="checkbox"
      :checked="isChecked"
      :title="title"
      @change="handleChange"
      class="toggle toggle-primary toggle-sm"
    />
    <span v-if="label" class="field-checkbox-label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl({ wrapped: true })

const props = withDefaults(
  defineProps<{
    value?: boolean
    modelValue?: boolean
    label?: string
    title?: string
  }>(),
  { value: false, modelValue: undefined }
)

const emit = defineEmits<{
  (e: 'update:value', value: boolean): void
  (e: 'update:modelValue', value: boolean): void
}>()

const isChecked = computed(() =>
  props.modelValue !== undefined ? props.modelValue : props.value
)

function handleChange(event?: Event) {
  const target = event?.target as HTMLInputElement | undefined
  const next = target ? target.checked : !isChecked.value
  emit('update:value', next)
  emit('update:modelValue', next)
}
</script>

<style scoped>
.field-checkbox {
  display: inline-flex;
  min-height: var(--control-size-sm);
  align-items: center;
  gap: 0.625rem;
  cursor: pointer;
  font-size: var(--text-body);
}

.field-checkbox-label {
  color: var(--app-text-muted);
}
</style>
