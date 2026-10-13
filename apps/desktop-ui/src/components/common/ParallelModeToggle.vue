<template>
  <ResultViewModeToggle
    :value="value"
    :label="t('menu.reviewResult')"
    :modes="modes"
    @update:value="emit('update:value', $event)"
  />
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import ResultViewModeToggle from './ResultViewModeToggle.vue'

export type ParallelViewMode = 'split' | 'result'
defineProps<{ value: ParallelViewMode }>()
const emit = defineEmits<{
  (e: 'update:value', value: ParallelViewMode): void
}>()
const { t } = useI18n()
const modes: ParallelViewMode[] = ['split', 'result']
</script>
