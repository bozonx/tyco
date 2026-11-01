<template>
  <SettingsSection :title="t('settings.sectionEditorHistory')">
    <div>
      <FieldRow
        :label="t('settings.editorHistoryStorage')"
        :info="t('settings.editorHistoryStorageHint')"
      >
        <FieldSelect
          :model-value="history.storage"
          :options="storageOptions"
          @update:model-value="setStorage"
        />
      </FieldRow>
      <div v-if="history.storage !== 'off'" class="history-nested">
        <FieldRow
          :label="t('settings.editorHistoryMaxItems')"
          nested
          :separator="false"
          :error="
            isLimitInvalid ? t('settings.numberTokensInvalid') : undefined
          "
        >
          <FieldNumber
            :min="1"
            :step="1"
            :model-value="typedLimit ?? history.maxItems"
            :aria-invalid="isLimitInvalid || undefined"
            @update:model-value="setLimit"
            @change="confirmLowerLimit"
            @invalid-input="isLimitInvalid = true"
          />
        </FieldRow>
        <template v-if="history.storage === 'disk'">
          <FieldRow
            :label="t('settings.editorHistoryRetentionDays')"
            :info="t('settings.editorHistoryRetentionDaysHint')"
            nested
            :separator="false"
          >
            <FieldSelect
              :model-value="history.retentionDays ?? 0"
              :options="retentionOptions"
              @update:model-value="setRetentionDays"
            />
          </FieldRow>
          <FieldRow
            :label="t('settings.sanitizeSecretsInEditorHistory')"
            :info="t('settings.sanitizeSecretsInEditorHistoryHint')"
            nested
            :separator="false"
          >
            <FieldSwitch
              :model-value="history.isSecretSanitizingEnabled ?? false"
              @update:model-value="history.isSecretSanitizingEnabled = $event"
            />
          </FieldRow>
        </template>
      </div>
    </div>

    <SettingsHistoryClear
      :label="t('history.clear')"
      :count-hint="t('settings.editorHistoryCount', { count: entryCount })"
      :confirm-title="t('settings.clearEditorHistoryConfirmTitle')"
      :confirm-message="t('settings.clearEditorHistoryConfirmDialog')"
      :clear="() => historyStore.clearEditorHistory()"
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

import { useEditorHistoryChanges } from '../../composables/use-editor-history-changes'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import { createEditorHistorySettingsModel } from '../../lib/history/editor-history-settings-model'
import { editorHistoryRetentionChoices } from '../../lib/history/editor-history-storage'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import { toHtmlLang } from '../../lib/locale/language'
import { clientLogger } from '../../lib/logger'
import { useHistoryStore } from '../../stores/history'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldNumber from '../common/FieldNumber.vue'
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

const {
  pendingChange,
  confirmChange,
  cancelChange,
  setRetentionDays,
  isLimitInvalid,
  typedLimit,
  setLimit,
  confirmLowerLimit,
  setStorage,
} = createEditorHistorySettingsModel({
  getHistory: () => history.value,
  limitMessage: (count) => t('settings.editorHistoryLimitConfirm', { count }),
  sessionMessage: () => t('settings.editorHistorySessionConfirm'),
  retentionMessage: (days) =>
    t('settings.editorHistoryRetentionConfirm', {
      period:
        retentionOptions.value.find((option) => option.id === days)?.name ?? '',
    }),
})

const storageOptions = computed(() => [
  { id: 'disk', name: t('settings.editorHistoryStorageDisk') },
  { id: 'session', name: t('settings.editorHistoryStorageSession') },
  { id: 'off', name: t('settings.editorHistoryStorageOff') },
])

const retentionOptions = computed(() =>
  historyRetentionOptions(
    editorHistoryRetentionChoices(history.value.retentionDays),
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.editorHistoryRetentionForever')
  )
)
</script>

<style scoped>
.history-nested {
  background-color: var(--app-surface-sunken);
  border-top: 1px solid var(--app-border-subtle);
  border-left: 2px solid var(--app-border-strong);
}
</style>
