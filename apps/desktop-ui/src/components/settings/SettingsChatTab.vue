<template>
  <div class="settings-stack">
    <SettingsSection :title="t('settings.chat')" :info="t('settings.chatInfo')">
      <FieldRow
        :label="t('settings.chatPrompt')"
        :info="t('settings.chatPromptInfo')"
        vertical
      >
        <FieldPromptTextArea
          v-model="userConfig.llm.tasks.chat.rule"
          :modal-title="t('settings.chatPrompt')"
        />
      </FieldRow>
    </SettingsSection>

    <SettingsSection bare>
      <template #description>
        {{ t('settings.chatStorageLink') }}
        <InlineAction @click="navigate('history')">
          {{ t('settings.historyTab') }}</InlineAction
        >.
      </template>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldPromptTextArea from '../common/FieldPromptTextArea.vue'
import FieldRow from '../common/FieldRow.vue'
import InlineAction from '../common/InlineAction.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()
</script>
