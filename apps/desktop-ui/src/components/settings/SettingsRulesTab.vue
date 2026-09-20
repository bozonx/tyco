<template>
  <div>
    <h2>{{ t('settings.aiRules') }}</h2>
    <FieldRow :label="t('settings.baseRules')">
      <FieldTextArea v-model:value="userConfig.aiRules.base" />
    </FieldRow>
    <FieldRow :label="t('settings.quickTranslation')">
      <FieldTextArea v-model:value="userConfig.aiRules.translate" />
    </FieldRow>
    <FieldRow :label="t('settings.voiceCorrectionRules')">
      <FieldTextArea v-model:value="userConfig.aiRules.voiceCorrection" />
    </FieldRow>
    <FieldRow :label="t('settings.textCorrection')">
      <FieldTextArea v-model:value="userConfig.aiRules.correction" />
    </FieldRow>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'

defineProps<{ userConfig: Record<string, any> }>()

const { t } = useI18n()
</script>
