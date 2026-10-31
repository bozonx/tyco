<template>
  <SettingsSection :title="t('settings.sectionEditorHistory')">
    <template #actions>
      <Button
        size="xs"
        variant="ghost"
        icon="mdi:trash-can-outline"
        @click="showClearModal = true"
      >
        {{ t('history.clear') }}
      </Button>
    </template>

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
            :model-value="history.maxItems"
            :aria-invalid="isLimitInvalid || undefined"
            @update:model-value="setLimit"
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
      @cancel="pendingChange = null"
    />
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { editorHistoryRetentionChoices } from '../../lib/history/editor-history-storage'
import {
  historyRetentionOptions,
  isStricterRetention,
} from '../../lib/history/history-retention'
import { toHtmlLang } from '../../lib/locale/language'
import { useHistoryStore } from '../../stores/history'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldNumber from '../common/FieldNumber.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()
const { toastKey } = useToast()
const historyStore = useHistoryStore()

const history = computed(() => userConfig.value.editor.history)

const showClearModal = ref(false)

async function onClear() {
  showClearModal.value = false
  await historyStore.clearEditorHistory()
  toastKey('history.cleared', 'info')
}

/** What is typed is not a limit: the stored one stays, and the field says so */
const isLimitInvalid = ref(false)

function setLimit(value: string) {
  const parsed = Number(value)
  isLimitInvalid.value =
    value.trim() === '' || !Number.isInteger(parsed) || parsed < 1
  if (isLimitInvalid.value) return
  history.value.maxItems = parsed
}

/** A change that deletes stored entries waits for the user to confirm it */
const pendingChange = ref<{ message: string; apply: () => void } | null>(null)

function confirmChange() {
  pendingChange.value?.apply()
  pendingChange.value = null
}

function setStorage(value: string | number | undefined) {
  if (value !== 'disk' && value !== 'session' && value !== 'off') return
  const apply = () => {
    history.value.storage = value
  }
  if (value === 'off' && history.value.storage !== 'off') {
    pendingChange.value = {
      message: t('settings.editorHistoryOffConfirm'),
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
