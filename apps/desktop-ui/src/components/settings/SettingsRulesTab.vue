<template>
  <SettingsSection>
    <FieldRow :label="t('settings.baseRules')" vertical>
      <FieldTextArea v-model:value="userConfig.aiRules.base" />
    </FieldRow>
    <FieldRow :label="t('settings.quickTranslation')" vertical>
      <FieldTextArea v-model:value="userConfig.aiRules.translate" />
    </FieldRow>
    <FieldRow :label="t('settings.voiceCorrectionRules')" vertical>
      <FieldTextArea v-model:value="userConfig.aiRules.voiceCorrection" />
    </FieldRow>
    <FieldRow :label="t('settings.textCorrection')" vertical>
      <FieldTextArea v-model:value="userConfig.aiRules.correction" />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'

defineProps<{ userConfig: Record<string, any> }>()

const { t } = useI18n()
</script>
