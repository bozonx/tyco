<template>
  <SettingsSection :title="t('settings.sectionAccessibility')">
    <FieldRow
      :label="t('settings.contrast')"
      :hint="isEInkTheme ? t('settings.forcedByEInk') : undefined"
    >
      <FieldSelect
        :model-value="appearance.contrast"
        @update:model-value="updateContrast"
        :disabled="isEInkTheme"
        :options="contrastOptions"
      />
    </FieldRow>
    <FieldRow
      :label="t('settings.motion')"
      :hint="isEInkTheme ? t('settings.forcedByEInk') : undefined"
    >
      <FieldSelect
        :model-value="appearance.motion"
        @update:model-value="updateMotion"
        :disabled="isEInkTheme"
        :options="motionOptions"
      />
    </FieldRow>
    <FieldRow :label="t('settings.uiScale')">
      <FieldSelect
        :model-value="appearance.uiScale"
        :options="uiScaleOptions"
        @update:model-value="updateUiScale"
      />
    </FieldRow>
  </SettingsSection>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'
import {
  type ContrastMode,
  type MotionMode,
  UI_SCALES,
  type UserConfig,
  isUiScale,
} from '@tyco/shared'

const props = defineProps<{ appearance: UserConfig['appearance'] }>()
const emit = defineEmits<{
  'update:appearance': [value: UserConfig['appearance']]
}>()
const { t } = useI18n()
const contrastOptions = computed<{ id: ContrastMode; name: string }[]>(() => [
  { id: 'auto', name: t('settings.contrastAuto') },
  { id: 'normal', name: t('settings.contrastNormal') },
  { id: 'more', name: t('settings.contrastMore') },
])

const motionOptions = computed<{ id: MotionMode; name: string }[]>(() => [
  { id: 'auto', name: t('settings.motionAuto') },
  { id: 'normal', name: t('settings.motionNormal') },
  { id: 'reduce', name: t('settings.motionReduce') },
])

const uiScaleOptions = UI_SCALES.map((scale) => ({
  id: scale,
  name: `${scale}%`,
}))

const isEInkTheme = computed(() => props.appearance.theme === 'e-ink')

// <select> reports option values as strings
const updateUiScale = (value: string | number | undefined) => {
  const scale = Number(value)

  if (isUiScale(scale)) {
    emit('update:appearance', { ...props.appearance, uiScale: scale })
  }
}
function updateContrast(value: string | number | undefined) {
  if (value === 'auto' || value === 'normal' || value === 'more')
    emit('update:appearance', { ...props.appearance, contrast: value })
}
function updateMotion(value: string | number | undefined) {
  if (value === 'auto' || value === 'normal' || value === 'reduce')
    emit('update:appearance', { ...props.appearance, motion: value })
}
</script>
