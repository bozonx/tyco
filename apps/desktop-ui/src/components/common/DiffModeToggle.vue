<template>
  <ResultViewModeToggle
    :value="value"
    :label="t('menu.compareResult')"
    :modes="modes"
    @update:value="emit('update:value', $event)"
  />
</template>
<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import type { DiffViewMode } from '../../lib/diff/diff-model'
import ResultViewModeToggle from './ResultViewModeToggle.vue'

defineProps<{ value: DiffViewMode }>()
const emit = defineEmits<{ (e: 'update:value', value: DiffViewMode): void }>()
const { t } = useI18n()
const modes: DiffViewMode[] = ['unified', 'split', 'result']
</script>
