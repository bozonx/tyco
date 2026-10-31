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

    <FieldRow
      :label="t('history.clear')"
      :hint="t('settings.editorHistoryCount', { count: entryCount })"
      inline
    >
      <Button
        size="sm"
        variant="ghost"
        icon="mdi:trash-can-outline"
        @click="showClearModal = true"
      >
        {{ t('history.clear') }}
      </Button>
    </FieldRow>

    <ConfirmModal
      :open="showClearModal"
      :title="t('settings.clearEditorHistoryConfirmTitle')"
      :message="t('settings.clearEditorHistoryConfirmDialog')"
      :confirm-text="t('history.clearConfirmButton')"
      danger
      @confirm="onClear"
      @cancel="showClearModal = false"
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
import { computed, onMounted, ref } from 'vue'

import { useEditorHistoryChanges } from '../../composables/use-editor-history-changes'
import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { editorHistoryRetentionChoices } from '../../lib/history/editor-history-storage'
import {
  historyRetentionOptions,
  isStricterRetention,
} from '../../lib/history/history-retention'
import { toHtmlLang } from '../../lib/locale/language'
import { clientLogger } from '../../lib/logger'
import { useHistoryStore } from '../../stores/history'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'

/** The limit the backend uses when the settings name none */
const DEFAULT_EDITOR_HISTORY_LIMIT = 1000

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()
const { toastKey } = useToast()
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

const showClearModal = ref(false)

async function onClear() {
  showClearModal.value = false
  try {
    await historyStore.clearEditorHistory()
    toastKey('history.cleared', 'info')
  } catch (error) {
    clientLogger.warn(
      `Could not clear the editor history: ${String(error)}`,
      'history'
    )
    toastKey('history.operationFailed', 'error')
  }
}

/** What is typed is not a limit: the stored one stays, and the field says so */
const isLimitInvalid = ref(false)
/**
 * A lower limit typed but not yet confirmed. It is applied once the field is
 * left, after the user agrees: the settings save as they change, and typing
 * "50" over "100" passes through "5"
 */
const typedLimit = ref<number | null>(null)
const currentLimit = () =>
  history.value.maxItems ?? DEFAULT_EDITOR_HISTORY_LIMIT

function setLimit(value: string) {
  const parsed = Number(value)
  isLimitInvalid.value =
    value.trim() === '' || !Number.isInteger(parsed) || parsed < 1
  if (isLimitInvalid.value) return
  if (parsed < currentLimit()) {
    typedLimit.value = parsed
    return
  }
  typedLimit.value = null
  history.value.maxItems = parsed
}

function confirmLowerLimit() {
  const limit = typedLimit.value
  if (limit === null || isLimitInvalid.value) return
  pendingChange.value = {
    message: t('settings.editorHistoryLimitConfirm', { count: limit }),
    apply: () => {
      history.value.maxItems = limit
      typedLimit.value = null
    },
    cancel: () => {
      typedLimit.value = null
    },
  }
}

/** A change that deletes stored entries waits for the user to confirm it */
const pendingChange = ref<{
  message: string
  apply: () => void
  cancel?: () => void
} | null>(null)

function confirmChange() {
  pendingChange.value?.apply()
  pendingChange.value = null
}

function cancelChange() {
  pendingChange.value?.cancel?.()
  pendingChange.value = null
}

function setStorage(value: string | number | undefined) {
  if (value !== 'disk' && value !== 'session' && value !== 'off') return
  const apply = () => {
    history.value.storage = value
  }
  // turning the history off only stops recording: the entries stay. Keeping
  // it for the session only moves the entries off the disk
  if (value === 'session' && history.value.storage !== 'session') {
    pendingChange.value = {
      message: t('settings.editorHistorySessionConfirm'),
      apply,
    }
  } else apply()
}

function setRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  const apply = () => {
    if (parsed === 0) delete history.value.retentionDays
    else history.value.retentionDays = parsed
  }
  if (isStricterRetention(history.value.retentionDays, parsed)) {
    const period =
      retentionOptions.value.find((option) => option.id === parsed)?.name ?? ''
    pendingChange.value = {
      message: t('settings.editorHistoryRetentionConfirm', { period }),
      apply,
    }
  } else apply()
}

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
