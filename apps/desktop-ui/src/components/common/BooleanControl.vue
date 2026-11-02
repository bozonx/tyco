<template>
  <label
    :class="[
      $attrs.class,
      { 'is-disabled opacity-50 cursor-not-allowed': isDisabled },
    ]"
    :style="$attrs.style"
    class="boolean-control"
    :title="title"
  >
    <input
      v-bind="controlAttrs()"
      type="checkbox"
      :role="kind === 'switch' ? 'switch' : undefined"
      :checked="props.modelValue"
      :disabled="isDisabled ? true : undefined"
      :title="title"
      @change="handleChange"
      :class="
        kind === 'switch'
          ? 'toggle toggle-primary'
          : 'checkbox checkbox-primary'
      "
    />
    <span v-if="label" class="boolean-control-label">{{ label }}</span>
  </label>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import type { BooleanControlProps } from '../../lib/ui/boolean-control'

defineOptions({ inheritAttrs: false })

const props = withDefaults(
  defineProps<BooleanControlProps & { kind: 'checkbox' | 'switch' }>(),
  { modelValue: false }
)

const controlAttrs = useFieldControl({
  wrapped: true,
  getLabel: () => props.label,
})

const isDisabled = computed(() =>
  Boolean(props.disabled || controlAttrs().disabled)
)

const emit = defineEmits<{ (e: 'update:modelValue', value: boolean): void }>()

function handleChange(event?: Event) {
  if (isDisabled.value) return
  const target = event?.target as HTMLInputElement | undefined
  const next = target ? target.checked : !props.modelValue

  emit('update:modelValue', next)
}
</script>

<style scoped>
.boolean-control {
  display: inline-flex;
  min-height: var(--control-size-sm);
  align-items: center;
  gap: 0.625rem;
  cursor: pointer;
  font-size: var(--text-body);
}

.boolean-control-label {
  color: var(--app-text-muted);
}
</style>
