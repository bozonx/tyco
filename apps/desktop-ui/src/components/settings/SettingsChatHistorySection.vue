<template>
  <SettingsSection
    :title="t('settings.sectionChatHistory')"
    :info="t('settings.chatHistoryHint')"
  >
    <template #actions>
      <SettingsHistoryClear
        :count="chatCount"
        :label-keys="{
          one: 'settings.deleteAllChats.one',
          few: 'settings.deleteAllChats.few',
          many: 'settings.deleteAllChats.many',
          other: 'settings.deleteAllChats.other',
        }"
        :confirm-title="t('history.clearConfirmTitle')"
        :confirm-message="t('settings.clearChatsConfirmDialog')"
        :clear="chats.clear"
      />
    </template>
    <FieldRow
      :label="t('settings.chatHistoryKeeping')"
      :info="t('settings.chatHistoryKeepingHint')"
      inline
    >
      <FieldSelect
        size="sm"
        class="w-44 shrink-0"
        :model-value="historyKeepingChoice(history)"
        :options="keepingOptions"
        @update:model-value="setKeeping"
      />
    </FieldRow>

    <FieldRow
      :label="t('settings.chatQuickRequestsSaved')"
      :info="t('settings.chatQuickRequestsSavedInfo')"
      inline
    >
      <FieldSwitch
        :model-value="history.isQuickRequestSavingEnabled !== false"
        @update:model-value="setQuickRequestSaving"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSettingsHistoryChats } from '../../composables/use-settings-history-chats'
import { chatHistoryRetentionChoices } from '../../lib/chat/chat-history-settings'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import {
  applyHistoryKeeping,
  historyKeepingChoice,
  historyKeepingOptions,
} from '../../lib/history/history-settings-model'
import { toHtmlLang } from '../../lib/locale/language'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsHistoryClear from './SettingsHistoryClear.vue'
import SettingsSection from './SettingsSection.vue'

/** The chats of "Ask AI" and of the profiles whose workspace sets nothing */
const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()

const history = computed(() => userConfig.value.chat.history)

const chats = useSettingsHistoryChats()
onMounted(() => {
  // the count stays at what was last read
  chats.load().catch(() => {})
})
const chatCount = computed(() => chats.count.value)

function setQuickRequestSaving(isEnabled: boolean) {
  if (isEnabled) delete history.value.isQuickRequestSavingEnabled
  else history.value.isQuickRequestSavingEnabled = false
}

const periodName = (days: number) =>
  historyRetentionOptions(
    [days],
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.editorHistoryRetentionForever')
  )[0]!.name

function setKeeping(value: string | number | undefined) {
  applyHistoryKeeping(history.value, value)
}

const keepingOptions = computed(() =>
  historyKeepingOptions(
    chatHistoryRetentionChoices(history.value.retentionDays),
    {
      session: t('settings.editorHistoryStorageSession'),
      forever: t('settings.editorHistoryRetentionForever'),
      period: periodName,
    }
  )
)
</script>
