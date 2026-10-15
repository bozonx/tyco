<template>
  <ResultViewModeToggle
    preset="diff"
    :value="value"
    @update:value="emit('update:value', $event)"
  />
</template>
<script setup lang="ts">
import type { DiffViewMode } from '../../lib/diff/diff-model'
import ResultViewModeToggle from './ResultViewModeToggle.vue'

defineProps<{ value: DiffViewMode }>()
const emit = defineEmits<{ (e: 'update:value', value: DiffViewMode): void }>()
</script>
