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
      :checked="value"
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

const props = defineProps<{ value: boolean; label?: string; title?: string }>()

const emit = defineEmits<{ (e: 'update:value', value: boolean): void }>()

function handleChange(event?: Event) {
  const target = event?.target as HTMLInputElement | undefined
  emit('update:value', target ? target.checked : !props.value)
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
