<template>
  <SettingsSection
    :title="t('settings.sectionDialogHistory')"
    :info="t('settings.dialogHistoryHint')"
  >
    <FieldRow
      :label="t('settings.dialogHistoryEnabled')"
      :info="t('settings.dialogHistoryEnabledInfo')"
      inline
    >
      <FieldSwitch
        :model-value="isSavingChecked"
        @update:model-value="setSavingEnabled"
      />
    </FieldRow>

    <FieldRow
      v-if="isSavingChecked"
      :label="t('settings.dialogHistoryRetentionDays')"
      :info="t('settings.dialogHistoryRetentionDaysHint')"
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
      :label="t('settings.deleteAllDialogs')"
      :count-hint="t('settings.dialogCount', { count: dialogCount })"
      :confirm-title="t('dialog.clearHistoryConfirmTitle')"
      :confirm-message="t('settings.clearDialogsConfirmDialog')"
      :clear="clearAllDialogs"
    />

    <ConfirmModal
      :open="pendingChange !== null"
      :title="t('settings.historyDeleteConfirmTitle')"
      :message="pendingChange?.message ?? ''"
      :confirm-text="t('common.delete')"
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
import { createHistorySettingsModel } from '../../lib/history/history-settings-model'
import { toHtmlLang } from '../../lib/locale/language'
import { useDialogHistoryStore } from '../../stores/dialog-history'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
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
const isSavingChecked = computed(() => history.value.storage !== 'off')

function setSavingEnabled(isEnabled: boolean) {
  ensureHistory().storage = isEnabled ? 'disk' : 'off'
}

async function clearAllDialogs() {
  await dialogHistoryStore.clearDialogs()
}

const { pendingChange, confirmChange, cancelChange, setRetentionDays } =
  createHistorySettingsModel({
    getRetentionDays: () => history.value.retentionDays,
    setRetentionDays: (days) => {
      const target = ensureHistory()
      if (days === undefined) delete target.retentionDays
      else target.retentionDays = days
    },
    retentionMessage: (days) =>
      t('settings.dialogHistoryRetentionConfirm', {
        period:
          retentionOptions.value.find((option) => option.id === days)?.name ??
          '',
      }),
  })

const retentionOptions = computed(() =>
  historyRetentionOptions(
    dialogHistoryRetentionChoices(history.value.retentionDays),
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.chatHistoryRetentionNever')
  )
)
</script>
