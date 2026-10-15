<template>
  <input
    ref="inputRef"
    v-bind="controlAttrs()"
    :data-size="size ?? 'md'"
    :type="type"
    :value="String(props.modelValue ?? '')"
    :placeholder="placeholder"
    class="input"
    :class="{ 'is-plain': appearance === 'plain' }"
    @input="handleInput"
  />
</template>

<script setup lang="ts">
import { ref } from 'vue'

import { useFieldControl } from '../../composables/use-field-control'
import { useTextControl } from '../../composables/use-text-control'
import type { ControlSize } from '../../lib/ui/control-types'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

const props = withDefaults(
  defineProps<{
    appearance?: 'default' | 'plain'
    size?: ControlSize
    modelValue?: string | number
    placeholder?: string
    type?: string
  }>(),
  { type: 'text' }
)

const inputRef = ref<HTMLInputElement | null>(null)
defineExpose(useTextControl(inputRef))

const emit = defineEmits<{ (e: 'update:modelValue', value: string): void }>()

function handleInput(event: Event) {
  const next = (event.target as HTMLInputElement).value

  emit('update:modelValue', next)
}
</script>

<style scoped>
input {
  width: 100%;
}
</style>
