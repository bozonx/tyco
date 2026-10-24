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
        <FieldSelect v-model="history.storage" :options="storageOptions" />
      </FieldRow>
      <div v-if="history.storage !== 'off'" class="history-nested">
        <FieldRow
          :label="t('settings.editorHistoryMaxItems')"
          nested
          :separator="false"
        >
          <FieldNumber
            :min="1"
            :step="1"
            :model-value="history.maxItems"
            @update:model-value="setLimit"
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
  </SettingsSection>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import { editorHistoryRetentionChoices } from '../../lib/history/editor-history-storage'
import { historyRetentionOptions } from '../../lib/history/history-retention'
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

function setLimit(value: string) {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 1) return
  history.value.maxItems = Math.round(parsed)
}

function setRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  if (parsed === 0) delete history.value.retentionDays
  else history.value.retentionDays = parsed
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
