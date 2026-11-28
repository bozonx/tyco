<template>
  <SettingsSection
    :title="t('settings.sectionDialogHistory')"
    :info="
      [
        t('settings.dialogHistoryHint'),
        t('settings.dialogHistoryRetentionDaysHint'),
      ].join('\n\n')
    "
  >
    <template #actions>
      <SettingsHistoryClear
        :count="dialogCount"
        :label-keys="{
          one: 'settings.deleteAllDialogs.one',
          few: 'settings.deleteAllDialogs.few',
          many: 'settings.deleteAllDialogs.many',
          other: 'settings.deleteAllDialogs.other',
        }"
        :confirm-title="t('dialog.clearHistoryConfirmTitle')"
        :confirm-message="t('settings.clearDialogsConfirmDialog')"
        :clear="clearAllDialogs"
      />
    </template>
    <FieldRow :label="t('settings.dialogHistoryRetentionDays')" inline>
      <FieldSelect
        size="sm"
        class="w-44 shrink-0"
        :model-value="historyKeepingChoice(history)"
        :options="keepingOptions"
        @update:model-value="setKeeping"
      />
    </FieldRow>
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
  applyHistoryKeeping,
  historyKeepingChoice,
  historyKeepingOptions,
} from '../../lib/history/history-settings-model'
import { toHtmlLang } from '../../lib/locale/language'
import { useDialogHistoryStore } from '../../stores/dialog-history'
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

function setKeeping(value: string | number | undefined) {
  applyHistoryKeeping(ensureHistory(), value)
}

const keepingOptions = computed(() =>
  historyKeepingOptions(
    dialogHistoryRetentionChoices(history.value.retentionDays),
    {
      session: t('settings.editorHistoryStorageSession'),
      forever: t('settings.editorHistoryRetentionForever'),
      period: periodName,
    }
  )
)
</script>
