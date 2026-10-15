<template>
  <input
    v-bind="controlAttrs()"
    :type="type"
    :value="String(props.modelValue ?? '')"
    :placeholder="placeholder"
    class="input"
    @input="handleInput"
  />
</template>

<script setup lang="ts">
import { useFieldControl } from '../../composables/use-field-control'

defineOptions({ inheritAttrs: false })
const controlAttrs = useFieldControl()

const props = withDefaults(
  defineProps<{
    modelValue?: string | number
    placeholder?: string
    type?: string
  }>(),
  { type: 'text' }
)

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
