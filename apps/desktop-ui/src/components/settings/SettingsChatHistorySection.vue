<template>
  <SettingsSection
    :title="t(texts.titleKey)"
    :info="texts.infoKey && t(texts.infoKey)"
  >
    <FieldRow
      :label="t('settings.chatHistoryEnabled')"
      :info="t('settings.chatHistoryEnabledInfo')"
      inline
    >
      <FieldSwitch
        :model-value="isChatSavingChecked"
        @update:model-value="setChatSavingEnabled"
      />
    </FieldRow>

    <FieldRow
      :label="t('settings.chatQuickRequestsSaved')"
      :info="t('settings.chatQuickRequestsSavedInfo')"
      inline
    >
      <FieldSwitch
        :model-value="isQuickRequestSavingChecked"
        @update:model-value="setQuickRequestSaving"
      />
    </FieldRow>

    <FieldRow
      v-if="isRetentionVisible"
      :label="t('settings.chatHistoryRetentionDays')"
      :info="t('settings.chatHistoryRetentionDaysHint')"
      inline
    >
      <FieldSelect
        size="sm"
        class="w-44 shrink-0"
        :model-value="history.retentionDays ?? 0"
        :options="retentionOptions"
        @update:model-value="setRetentionDays"
      />
    </FieldRow>

    <SettingsHistoryClear
      :label="t('settings.deleteAllChats')"
      :count-hint="t('settings.chatCount', { count: chatCount })"
      :confirm-title="t('history.clearConfirmTitle')"
      :confirm-message="t(texts.confirmKey)"
      :clear="scopeChats.clear"
    />

    <ConfirmModal
      :open="pendingChange !== null"
      :title="t('settings.historyDeleteConfirmTitle')"
      :message="pendingChange?.message ?? ''"
      :confirm-text="t('common.delete')"
      danger
      @confirm="confirmChange"
      @cancel="cancelChange"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { useSettingsHistoryChats } from '../../composables/use-settings-history-chats'
import {
  type ChatHistoryScope,
  chatHistoryConfig,
  chatHistoryRetentionChoices,
} from '../../lib/chat/chat-history-settings'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import { createHistorySettingsModel } from '../../lib/history/history-settings-model'
import { toHtmlLang } from '../../lib/locale/language'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsHistoryClear from './SettingsHistoryClear.vue'
import SettingsSection from './SettingsSection.vue'

const props = withDefaults(defineProps<{ scope?: ChatHistoryScope }>(), {
  scope: 'askAi',
})

const TEXTS = {
  askAi: {
    titleKey: 'settings.sectionChatHistory',
    infoKey: 'settings.chatHistoryHint',
    confirmKey: 'settings.clearChatsConfirmDialog',
  },
  profiles: {
    titleKey: 'settings.sectionProfileChatHistory',
    infoKey: 'settings.profileChatHistoryHint',
    confirmKey: 'settings.clearProfileChatsConfirmDialog',
  },
} as const

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()

const texts = computed(() => TEXTS[props.scope])
const history = computed(() => chatHistoryConfig(userConfig.value, props.scope))

const scopeChats = useSettingsHistoryChats(props.scope)

onMounted(() => {
  // the count stays at what was last read
  scopeChats.load().catch(() => {})
})

const chatCount = computed(() => scopeChats.count.value)

const isChatSavingChecked = computed(
  () =>
    history.value.storage !== 'off' &&
    history.value.isChatSavingEnabled !== false
)

const isQuickRequestSavingChecked = computed(
  () =>
    history.value.storage !== 'off' &&
    history.value.isQuickRequestSavingEnabled !== false
)

const isRetentionVisible = computed(
  () => isChatSavingChecked.value || isQuickRequestSavingChecked.value
)

function setChatSavingEnabled(isEnabled: boolean) {
  if (isEnabled) {
    if (
      history.value.storage === 'off' &&
      history.value.isQuickRequestSavingEnabled === undefined
    ) {
      history.value.isQuickRequestSavingEnabled = false
    }
    history.value.storage = 'disk'
    delete history.value.isChatSavingEnabled
  } else {
    history.value.isChatSavingEnabled = false
    if (!isQuickRequestSavingChecked.value) {
      history.value.storage = 'off'
    }
  }
}

function setQuickRequestSaving(isEnabled: boolean) {
  if (isEnabled) {
    if (
      history.value.storage === 'off' &&
      history.value.isChatSavingEnabled === undefined
    ) {
      history.value.isChatSavingEnabled = false
    }
    history.value.storage = 'disk'
    delete history.value.isQuickRequestSavingEnabled
  } else {
    history.value.isQuickRequestSavingEnabled = false
    if (!isChatSavingChecked.value) {
      history.value.storage = 'off'
    }
  }
}

const { pendingChange, confirmChange, cancelChange, setRetentionDays } =
  createHistorySettingsModel({
    getRetentionDays: () => history.value.retentionDays,
    setRetentionDays: (days) => {
      if (days === undefined) delete history.value.retentionDays
      else history.value.retentionDays = days
    },
    retentionMessage: (days) =>
      t('settings.chatHistoryRetentionConfirm', {
        period:
          retentionOptions.value.find((option) => option.id === days)?.name ??
          '',
      }),
  })

const retentionOptions = computed(() =>
  historyRetentionOptions(
    chatHistoryRetentionChoices(history.value.retentionDays),
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.chatHistoryRetentionNever')
  )
)
</script>
