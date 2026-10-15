<template>
  <SegmentedControl
    :model-value="modelValue"
    :label="resolvedLabel"
    :options="options"
    compact
    hide-labels-on-small-screens
    @update:model-value="selectMode"
  />
</template>
<script setup lang="ts" generic="T extends DiffViewMode">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { DiffViewMode } from '../../lib/diff/diff-model'
import SegmentedControl from './SegmentedControl.vue'

export type ResultViewPreset = 'diff' | 'parallel'

const props = withDefaults(
  defineProps<{
    modelValue: T
    label?: string
    modes?: T[]
    preset?: ResultViewPreset
  }>(),
  { label: undefined, modes: undefined, preset: 'diff' }
)
const emit = defineEmits<{ (e: 'update:modelValue', value: T): void }>()
const { t } = useI18n()
const MODE_OPTIONS = {
  unified: { labelKey: 'diff.modeUnified', icon: 'mdi:view-agenda-outline' },
  split: { labelKey: 'diff.modeSplit', icon: 'mdi:view-split-vertical' },
  result: { labelKey: 'diff.modeResult', icon: 'mdi:file-document-outline' },
} as const

const resolvedLabel = computed(
  () =>
    props.label ??
    (props.preset === 'parallel'
      ? t('menu.reviewResult')
      : t('menu.compareResult'))
)

const resolvedModes = computed<T[]>(
  () =>
    props.modes ??
    (props.preset === 'parallel'
      ? (['split', 'result'] as T[])
      : (['unified', 'split', 'result'] as T[]))
)

const options = computed(() =>
  resolvedModes.value.map((id) => ({
    id,
    name: t(MODE_OPTIONS[id].labelKey),
    icon: MODE_OPTIONS[id].icon,
  }))
)
function selectMode(mode: T) {
  if (props.modelValue !== mode) emit('update:modelValue', mode)
}
</script>
