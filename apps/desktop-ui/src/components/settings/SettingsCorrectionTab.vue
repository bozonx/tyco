<template>
  <div class="settings-stack">
    <SettingsSection>
      <template #description>
        <I18nText keypath="settings.correctionPageHint">
          <template #tab>
            <InlineAction @click="navigate('global-actions')">{{
              t('settings.hotkeysTab')
            }}</InlineAction>
          </template>
        </I18nText>
      </template>

      <SettingsTaskModel task="correction" />
      <FieldRow
        :label="t('settings.correctionPrompt')"
        :info="t('settings.correctionPromptInfo')"
        vertical
      >
        <FieldTextArea
          v-model="userConfig.llm.tasks.correction.rule"
          :placeholder="t('settings.correctionPromptPlaceholder')"
        />
      </FieldRow>

      <FieldRow
        :label="t('settings.quickCorrectionMode')"
        :info="t('settings.quickCorrectionModeInfo')"
      >
        <FieldSelect
          class="w-full"
          :model-value="userConfig.quickWindow.correctionMode"
          :options="quickCorrectionOptions"
          @update:model-value="updateQuickCorrectionMode"
        />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import type { ControlOption } from '../../lib/ui/control-option'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import I18nText from '../common/I18nText.vue'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import { QUICK_CORRECTION_MODES, type QuickCorrectionMode } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()

const quickCorrectionOptions = computed<ControlOption<QuickCorrectionMode>[]>(
  () => [
    { id: 'live', name: t('settings.quickCorrectionLive') },
    { id: 'onSubmit', name: t('settings.quickCorrectionOnSubmit') },
    { id: 'off', name: t('settings.quickCorrectionOff') },
  ]
)

function updateQuickCorrectionMode(value: string | number | undefined) {
  if (
    typeof value === 'string' &&
    (QUICK_CORRECTION_MODES as readonly string[]).includes(value)
  ) {
    userConfig.value.quickWindow.correctionMode = value as QuickCorrectionMode
  }
}
</script>
