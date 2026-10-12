<template>
  <SegmentedControl
    :value="modelValue"
    :label="t('menu.reviewResult')"
    :options="options"
    compact
    hide-labels-on-small-screens
    @update:value="selectMode"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import SegmentedControl from './SegmentedControl.vue'

export type ParallelViewMode = 'split' | 'result'
const props = defineProps<{ modelValue: ParallelViewMode }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: ParallelViewMode): void
}>()
const { t } = useI18n()
const options = computed<
  { id: ParallelViewMode; name: string; icon: string }[]
>(() => [
  { id: 'split', name: t('diff.modeSplit'), icon: 'mdi:view-split-vertical' },
  {
    id: 'result',
    name: t('diff.modeResult'),
    icon: 'mdi:file-document-outline',
  },
])
function selectMode(mode: ParallelViewMode) {
  if (props.modelValue !== mode) emit('update:modelValue', mode)
}
</script>
