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
        group
        :label="t('settings.quickCorrectionMode')"
        :info="t('settings.quickCorrectionModeInfo')"
      >
        <SegmentedControl
          v-model="userConfig.quickWindow.correctionMode"
          :label="t('settings.quickCorrectionMode')"
          :options="quickCorrectionOptions"
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
import FieldTextArea from '../common/FieldTextArea.vue'
import I18nText from '../common/I18nText.vue'
import InlineAction from '../common/InlineAction.vue'
import SegmentedControl from '../common/SegmentedControl.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'
import type { QuickCorrectionMode } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()

const quickCorrectionOptions = computed<ControlOption<QuickCorrectionMode>[]>(
  () => [
    { id: 'live', name: t('settings.quickCorrectionLive') },
    { id: 'onSubmit', name: t('settings.quickCorrectionOnSubmit') },
    { id: 'off', name: t('settings.quickCorrectionOff') },
  ]
)
</script>
