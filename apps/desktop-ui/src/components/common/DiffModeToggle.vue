<template>
  <SegmentedControl
    :value="modelValue"
    :label="t('menu.compareResult')"
    :options="options"
    compact
    hide-labels-on-small-screens
    @update:value="selectMode"
  />
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { DiffViewMode } from '../../lib/diff/diff-model'
import SegmentedControl from './SegmentedControl.vue'

const props = defineProps<{ modelValue: DiffViewMode }>()
const emit = defineEmits<{
  (e: 'update:modelValue', value: DiffViewMode): void
}>()
const { t } = useI18n()
const options = computed<{ id: DiffViewMode; name: string; icon: string }[]>(
  () => [
    {
      id: 'unified',
      name: t('diff.modeUnified'),
      icon: 'mdi:view-agenda-outline',
    },
    { id: 'split', name: t('diff.modeSplit'), icon: 'mdi:view-split-vertical' },
    {
      id: 'result',
      name: t('diff.modeResult'),
      icon: 'mdi:file-document-outline',
    },
  ]
)
function selectMode(mode: DiffViewMode) {
  if (props.modelValue !== mode) emit('update:modelValue', mode)
}
</script>
