<template>
  <FieldRow
    :label="t(texts.label)"
    :info="info"
    :error="isInvalid ? t(texts.error) : undefined"
  >
    <FieldNumber
      :min="kind === 'temperature' ? 0 : 1"
      :max="kind === 'temperature' ? MAX_PROFILE_TEMPERATURE : undefined"
      :step="kind === 'temperature' ? 0.1 : 1"
      :model-value="modelValue"
      :placeholder="placeholder"
      @update:model-value="emit('update:modelValue', $event)"
      @invalid-input="emit('invalidInput')"
    />
  </FieldRow>
</template>
<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import { MAX_PROFILE_TEMPERATURE } from '@tyco/shared'

const props = defineProps<{
  kind: 'temperature' | 'maxOutputTokens' | 'contextWindowTokens'
  modelValue: string | number
  isInvalid?: boolean
  placeholder: string
  info?: string
}>()
const emit = defineEmits<{
  'update:modelValue': [value: string]
  invalidInput: []
}>()
const { t } = useI18n()
const TEXTS = {
  temperature: {
    label: 'settings.temperature',
    error: 'settings.numberTemperatureInvalid',
  },
  maxOutputTokens: {
    label: 'settings.maxTokens',
    error: 'settings.numberTokensInvalid',
  },
  contextWindowTokens: {
    label: 'settings.contextSize',
    error: 'settings.numberTokensInvalid',
  },
} as const
const texts = computed(() => TEXTS[props.kind])
</script>
