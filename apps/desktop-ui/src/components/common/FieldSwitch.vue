<template>
  <BooleanControl
    v-bind="props"
    kind="switch"
    @update:model-value="emit('update:modelValue', $event)"
  />
</template>
<script setup lang="ts">
import type { BooleanControlProps } from '../../lib/ui/boolean-control'
import BooleanControl from './BooleanControl.vue'

const props = withDefaults(defineProps<BooleanControlProps>(), {
  disabled: false,
})
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
