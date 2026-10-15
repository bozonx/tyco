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
      :checked="props.modelValue"
      :title="title"
      @change="handleChange"
      class="toggle toggle-primary toggle-sm"
    />
    <span v-if="label" class="field-checkbox-label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
import { useFieldControl } from '../../composables/use-field-control'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl({ wrapped: true })

const props = withDefaults(
  defineProps<{ modelValue?: boolean; label?: string; title?: string }>(),
  { modelValue: false }
)

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

function handleChange(event?: Event) {
  const target = event?.target as HTMLInputElement | undefined
  const next = target ? target.checked : !props.modelValue

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
