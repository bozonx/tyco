<template>
  <ResultViewModeToggle
    preset="parallel"
    :value="value"
    @update:value="emit('update:value', $event)"
  />
</template>
<script setup lang="ts">
import ResultViewModeToggle from './ResultViewModeToggle.vue'

export type ParallelViewMode = 'split' | 'result'
defineProps<{ value: ParallelViewMode }>()
const emit = defineEmits<{
  (e: 'update:value', value: ParallelViewMode): void
}>()
</script>
