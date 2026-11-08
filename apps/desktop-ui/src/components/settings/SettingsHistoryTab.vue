<template>
  <div class="settings-stack">
    <SettingsEditorHistorySection />
    <SettingsChatHistorySection scope="askAi" />

    <SettingsSection bare>
      <template #description>
        {{ t('settings.profileChatHistoryLink') }}
        <InlineAction @click="navigate('ai-profiles')">
          {{ t('settings.aiProfilesTab') }}</InlineAction
        >.
      </template>
    </SettingsSection>
  </div>
</template>

<script setup lang="ts">
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import InlineAction from '../common/InlineAction.vue'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'
import SettingsEditorHistorySection from './SettingsEditorHistorySection.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { navigate } = useSettingsContext()
</script>
