<template>
  <SettingsSection
    :title="t('settings.quickInputSectionTitle')"
    :description="t('settings.quickInputBehaviorHint')"
  >
    <FieldRow
      :label="t('settings.quickCorrectionPrefetchLabel')"
      :hint="t('settings.quickCorrectionPrefetchHint')"
    >
      <FieldCheckbox
        :value="userConfig.quickCorrectionPrefetch === true"
        @update:value="userConfig.quickCorrectionPrefetch = $event"
      />
    </FieldRow>
    <FieldRow
      :label="t('settings.quickHideOnBlurLabel')"
      :hint="t('settings.quickHideOnBlurHint')"
    >
      <FieldCheckbox
        :value="userConfig.quickHideOnBlur !== false"
        @update:value="userConfig.quickHideOnBlur = $event"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/useI18n'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldRow from '../common/FieldRow.vue'
import SettingsSection from '../common/SettingsSection.vue'
import type { UserConfig } from '@tyco/shared'

defineProps<{ userConfig: UserConfig }>()
const { t } = useI18n()
</script>
