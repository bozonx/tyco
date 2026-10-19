<template>
  <FieldRow
    :label="t('settings.fastNote.template')"
    :hint="t('settings.fastNote.templateHint')"
    vertical
  >
    <FieldSelect v-model="selected" :options="options" />
    <Button size="sm" @click="apply">{{ t('settings.fastNote.apply') }}</Button>
  </FieldRow>
</template>
<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { configOptionLabel } from '../../lib/config-fields/config-field-labels'
import Button from '../common/Button.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import {
  FAST_NOTE_PRESETS,
  type FastNotePreset,
} from '@tyco/plugin-fast-note/templates'
import type { InputConfigItem } from '@tyco/plugin-sdk'

const props = defineProps<{ field?: InputConfigItem }>()
const emit = defineEmits<{ apply: [values: Record<string, unknown>] }>()
const { t } = useI18n()
const selected = ref('default')
const options = computed(() =>
  (props.field?.options ?? [])
    .filter((option) => option.id !== 'custom')
    .map((option) => ({
      id: String(option.id),
      name: configOptionLabel(option, t),
    }))
)
function apply() {
  emit('apply', {
    ...FAST_NOTE_PRESETS[selected.value as FastNotePreset],
    preset: 'custom',
  })
}
</script>
