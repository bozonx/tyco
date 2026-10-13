<template>
  <SegmentedControl
    :value="value"
    :label="label"
    :options="options"
    compact
    hide-labels-on-small-screens
    @update:value="selectMode"
  />
</template>
<script setup lang="ts" generic="T extends DiffViewMode">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import type { DiffViewMode } from '../../lib/diff/diff-model'
import SegmentedControl from './SegmentedControl.vue'

const props = defineProps<{ value: T; label: string; modes: T[] }>()
const emit = defineEmits<{ (e: 'update:value', value: T): void }>()
const { t } = useI18n()
const MODE_OPTIONS = {
  unified: { labelKey: 'diff.modeUnified', icon: 'mdi:view-agenda-outline' },
  split: { labelKey: 'diff.modeSplit', icon: 'mdi:view-split-vertical' },
  result: { labelKey: 'diff.modeResult', icon: 'mdi:file-document-outline' },
} as const
const options = computed(() =>
  props.modes.map((id) => ({
    id,
    name: t(MODE_OPTIONS[id].labelKey),
    icon: MODE_OPTIONS[id].icon,
  }))
)
function selectMode(mode: T) {
  if (props.value !== mode) emit('update:value', mode)
}
</script>
