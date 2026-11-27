<template>
  <SettingsSection :title="t('settings.sectionEditorHistory')">
    <template #actions>
      <SettingsHistoryClear
        :count="entryCount"
        :label-keys="{
          one: 'settings.deleteAllEntries.one',
          few: 'settings.deleteAllEntries.few',
          many: 'settings.deleteAllEntries.many',
          other: 'settings.deleteAllEntries.other',
        }"
        :confirm-title="t('settings.clearEditorHistoryConfirmTitle')"
        :confirm-message="t('settings.clearEditorHistoryConfirmDialog')"
        :clear="() => historyStore.clearEditorHistory()"
      />
    </template>
    <FieldRow
      :label="t('settings.editorHistoryStorage')"
      :info="t('settings.editorHistoryStorageHint')"
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
      v-if="history.storage === 'disk'"
      :label="t('settings.sanitizeSecretsInEditorHistory')"
      :info="t('settings.sanitizeSecretsInEditorHistoryHint')"
      inline
    >
      <FieldSwitch
        :model-value="history.isSecretSanitizingEnabled ?? false"
        @update:model-value="history.isSecretSanitizingEnabled = $event"
      />
    </FieldRow>
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, onMounted } from 'vue'

import { useEditorHistoryChanges } from '../../composables/use-editor-history-changes'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { editorHistoryRetentionChoices } from '../../lib/history/editor-history-storage'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import {
  applyHistoryKeeping,
  historyKeepingChoice,
  historyKeepingOptions,
} from '../../lib/history/history-settings-model'
import { toHtmlLang } from '../../lib/locale/language'
import { clientLogger } from '../../lib/logger'
import { useHistoryStore } from '../../stores/history'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsHistoryClear from './SettingsHistoryClear.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()
const historyStore = useHistoryStore()

const history = computed(() => userConfig.value.editor.history)

/**
 * How many entries are stored. Turning the history off keeps them, so the count
 * tells that there is something to clear
 */
const entryCount = computed(() => historyStore.editorHistory.length)

const loadEntries = async () => {
  try {
    await historyStore.loadEditorHistory()
  } catch (error) {
    // the count stays as last read
    clientLogger.warn(
      `Could not count the editor history: ${String(error)}`,
      'history'
    )
  }
}
onMounted(() => void loadEntries())
useEditorHistoryChanges(() => void loadEntries())

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
    editorHistoryRetentionChoices(history.value.retentionDays),
    {
      session: t('settings.editorHistoryStorageSession'),
      forever: t('settings.editorHistoryRetentionForever'),
      period: periodName,
    }
  )
)
</script>
