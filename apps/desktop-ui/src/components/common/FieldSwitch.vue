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

const props = defineProps<BooleanControlProps>()
const emit = defineEmits<{ 'update:modelValue': [value: boolean] }>()
</script>
