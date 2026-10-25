<template>
  <div class="settings-stack">
    <SettingsSection>
      <FieldRow
        :label="t('settings.chatPrompt')"
        :info="t('settings.chatPromptInfo')"
        vertical
      >
        <FieldTextArea v-model="userConfig.llm.tasks.chat.rule" />
      </FieldRow>
    </SettingsSection>

    <SettingsChatHistorySection scope="askAi" />
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldRow from '../common/FieldRow.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()
</script>
