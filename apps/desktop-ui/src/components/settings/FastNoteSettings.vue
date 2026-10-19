<template>
  <FastNoteTemplatePicker :field="presetField" @apply="apply" />
  <FieldRow
    :label="t('settings.fastNote.folder')"
    :hint="t('settings.fastNote.pathHint')"
    vertical
  >
    <FieldInput
      :model-value="String(values.pathToNotes ?? '')"
      @update:model-value="updatePath"
    />
    <FastNoteDirectoryPicker @select="updatePath" />
  </FieldRow>
  <ConfigFields :config="visibleFields" @update:values="updateFields" />
  <FastNotePreview :config="values" />
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import ConfigFields from './ConfigFields.vue'
import FastNoteDirectoryPicker from './FastNoteDirectoryPicker.vue'
import FastNotePreview from './FastNotePreview.vue'
import FastNoteTemplatePicker from './FastNoteTemplatePicker.vue'
import type { InputConfigItem } from '@tyco/plugin-sdk'

const props = defineProps<{ fields: InputConfigItem[] }>()
const emit = defineEmits<{ update: [values: Record<string, unknown>] }>()
const { t } = useI18n()
const values = computed(() =>
  Object.fromEntries(
    props.fields.map((field) => [field.name, field.value ?? field.defaultValue])
  )
)
const presetField = computed(() =>
  props.fields.find((field) => field.name === 'preset')
)
const visibleFields = computed(() =>
  props.fields.filter(
    (field) =>
      !['preset', 'pathToNotes'].includes(field.name) &&
      (field.name !== 'customSubfolderTemplate' ||
        values.value.folderPreset === 'custom')
  )
)
function apply(patch: Record<string, unknown>) {
  emit('update', { ...values.value, ...patch })
}
function updateFields(patch: Record<string, unknown>) {
  apply({ ...patch, preset: 'custom' })
}
function updatePath(path: string | undefined) {
  apply({ pathToNotes: path ?? '' })
}
</script>
