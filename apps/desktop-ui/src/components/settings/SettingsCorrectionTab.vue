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
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import I18nText from '../common/I18nText.vue'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()
</script>
