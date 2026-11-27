<template>
  <SettingsSection
    :title="`${t('settings.sectionDialogHistory')} (${t('settings.dialogCount', { count: dialogCount })})`"
    :info="t('settings.dialogHistoryHint')"
  >
    <template #actions>
      <SettingsHistoryClear
        :is-empty="dialogCount === 0"
        :confirm-title="t('dialog.clearHistoryConfirmTitle')"
        :confirm-message="t('settings.clearDialogsConfirmDialog')"
        :clear="clearAllDialogs"
      />
    </template>
    <FieldRow
      :label="t('settings.dialogHistoryRetentionDays')"
      :info="t('settings.dialogHistoryRetentionDaysHint')"
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
import {
  dialogHistoryConfig,
  dialogHistoryRetentionChoices,
} from '../../lib/dialog/dialog-history-storage'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import {
  createHistoryKeepingModel,
  historyKeepingChoice,
  historyKeepingOptions,
} from '../../lib/history/history-settings-model'
import { toHtmlLang } from '../../lib/locale/language'
import { useDialogHistoryStore } from '../../stores/dialog-history'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsHistoryClear from './SettingsHistoryClear.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()
const dialogHistoryStore = useDialogHistoryStore()

const history = computed(
  () => userConfig.value.dialog.history ?? dialogHistoryConfig(userConfig.value)
)

function ensureHistory() {
  if (!userConfig.value.dialog.history) {
    userConfig.value.dialog.history = dialogHistoryConfig(userConfig.value)
  }
  return userConfig.value.dialog.history
}

onMounted(() => {
  dialogHistoryStore.loadDialogs().catch(() => {})
})

const dialogCount = computed(() => dialogHistoryStore.dialogs.length)

async function clearAllDialogs() {
  await dialogHistoryStore.clearDialogs()
}

const periodName = (days: number) =>
  historyRetentionOptions(
    [days],
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.editorHistoryRetentionForever')
  )[0]!.name

const { pendingChange, confirmChange, cancelChange, setKeeping } =
  createHistoryKeepingModel({
    getHistory: () => history.value,
    editHistory: ensureHistory,
    retentionMessage: (days) =>
      t('settings.dialogHistoryRetentionConfirm', { period: periodName(days) }),
  })

const keepingOptions = computed(() =>
  historyKeepingOptions(
    dialogHistoryRetentionChoices(history.value.retentionDays),
    {
      off: t('settings.workspaceHistory.notSaved'),
      forever: t('settings.editorHistoryRetentionForever'),
      period: periodName,
    }
  )
)
</script>
