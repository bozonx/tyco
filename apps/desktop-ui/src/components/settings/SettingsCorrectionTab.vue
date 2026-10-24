<template>
  <div class="settings-stack">
    <SettingsSection>
      <template #description>
        <span>{{ t('settings.correctionPageHint') }}</span
        >{{ ' ' }}
        <InlineAction @click="navigate('global-actions')">
          {{ t('settings.hotkeysTab') }}</InlineAction
        >.
      </template>

      <SettingsTaskModel task="correction" />
      <FieldRow
        :label="t('settings.correctionPrompt')"
        :info="t('settings.correctionPromptInfo')"
        vertical
      >
        <FieldTextArea v-model="userConfig.llm.tasks.correction.rule" />
      </FieldRow>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from './SettingsSection.vue'
import SettingsTaskModel from './SettingsTaskModel.vue'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()
</script>
