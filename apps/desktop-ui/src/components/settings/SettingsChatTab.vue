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
      <FieldRow
        :label="t('settings.chatImageQuality')"
        :info="t('settings.chatImageQualityHint')"
      >
        <FieldSelect
          :model-value="userConfig.chat.imageQuality || 'balanced'"
          :options="imageQualityOptions"
          @update:model-value="
            userConfig.chat.imageQuality =
              $event as UserConfig['chat']['imageQuality']
          "
        />
      </FieldRow>
    </SettingsSection>

    <SettingsChatHistorySection />
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldTextArea from '../common/FieldTextArea.vue'
import SettingsChatHistorySection from './SettingsChatHistorySection.vue'
import SettingsSection from './SettingsSection.vue'
import type { UserConfig } from '@tyco/shared'

const { t } = useI18n()
const { draft: userConfig } = useSettingsContext()

const imageQualityOptions = computed(() => [
  { id: 'economy', name: t('settings.imageQualityEconomy') },
  { id: 'balanced', name: t('settings.imageQualityBalanced') },
  { id: 'original', name: t('settings.imageQualityOriginal') },
])
</script>
