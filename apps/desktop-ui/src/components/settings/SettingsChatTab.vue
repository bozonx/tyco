<template>
  <div class="settings-stack">
    <SettingsSection :title="t('settings.chat')" :info="t('settings.chatInfo')">
      <FieldRow
        :label="t('settings.chatInstructions')"
        :info="t('settings.chatInstructionsInfo')"
        vertical
      >
        <FieldPromptTextArea
          v-model="userConfig.llm.tasks.chat.rule"
          :modal-title="t('settings.chatInstructions')"
        />
      </FieldRow>
      <FieldRow
        :label="t('settings.askAiWebSearch')"
        :info="t('settings.askAiWebSearchHint')"
      >
        <FieldSwitch
          :aria-label="t('settings.askAiWebSearch')"
          :model-value="userConfig.llm.tasks.chat.isWebSearchEnabled !== false"
          @update:model-value="
            userConfig.llm.tasks.chat.isWebSearchEnabled = $event
          "
        />
      </FieldRow>
      <InlineNotice
        density="compact"
        kind="info"
        icon="mdi:lightning-bolt-outline"
        :message="t('settings.askAiFastModelsHint')"
      />
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
import FieldSwitch from '../common/FieldSwitch.vue'
import InlineAction from '../common/InlineAction.vue'
import InlineNotice from '../common/InlineNotice.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, navigate } = useSettingsContext()
</script>
