<template>
  <div class="flex flex-col gap-6">
    <SettingsSection :title="t('settings.sectionEditorHistory')">
      <template #actions>
        <Button
          xs
          ghost
          class="text-error"
          icon="mdi:trash-can-outline"
          @click="showClearEditorHistoryModal = true"
        >
          {{ t('history.clear') }}
        </Button>
      </template>

      <div class="editor-history-group">
        <FieldRow
          :label="t('settings.editorHistoryStorage')"
          :info="t('settings.editorHistoryStorageHint')"
        >
          <FieldSelect
            v-model:value="userConfig.editorHistoryStorage"
            :options="editorHistoryStorageOptions"
          />
        </FieldRow>
        <div
          v-if="userConfig.editorHistoryStorage !== 'off'"
          class="editor-history-nested"
        >
          <FieldRow :label="t('settings.editorHistoryMaxItems')" nested>
            <FieldInput
              type="number"
              :value="userConfig.editorHistoryMaxItems"
              @update:value="setEditorHistoryLimit"
            />
          </FieldRow>
          <template v-if="userConfig.editorHistoryStorage === 'disk'">
            <FieldRow
              :label="t('settings.editorHistoryRetentionDays')"
              :info="t('settings.editorHistoryRetentionDaysHint')"
              nested
            >
              <FieldSelect
                :value="userConfig.editorHistoryRetentionDays ?? 0"
                :options="editorHistoryRetentionOptions"
                @update:value="setEditorHistoryRetentionDays"
              />
            </FieldRow>
            <FieldRow
              :label="t('settings.sanitizeSecretsInEditorHistory')"
              :info="t('settings.sanitizeSecretsInEditorHistoryHint')"
              nested
            >
              <FieldCheckbox
                v-model:value="userConfig.sanitizeSecretsInEditorHistory"
              />
            </FieldRow>
          </template>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('settings.sectionChatHistory')">
      <template #actions>
        <Button
          xs
          ghost
          class="text-error"
          icon="mdi:trash-can-outline"
          @click="showClearChatHistoryModal = true"
        >
          {{ t('history.clear') }}
        </Button>
      </template>

      <div class="editor-history-group">
        <FieldRow
          :label="t('settings.chatHistoryEnabled')"
          :info="t('settings.chatHistoryEnabledHint')"
        >
          <FieldCheckbox
            :value="chatHistoryChecked"
            @update:value="setChatHistoryEnabled"
          />
        </FieldRow>
        <div v-if="chatHistoryChecked" class="editor-history-nested">
          <FieldRow
            :label="t('settings.chatHistoryRetentionDays')"
            :info="t('settings.chatHistoryRetentionDaysHint')"
            nested
          >
            <FieldSelect
              :value="userConfig.chatHistoryRetentionDays ?? 0"
              :options="chatHistoryRetentionOptions"
              @update:value="setChatHistoryRetentionDays"
            />
          </FieldRow>
        </div>
      </div>
    </SettingsSection>

    <ConfirmModal
      :open="showClearEditorHistoryModal"
      :title="t('settings.clearEditorHistoryConfirmTitle')"
      :message="t('settings.clearEditorHistoryConfirmDialog')"
      :confirm-text="t('history.clearConfirmButton')"
      danger
      @confirm="onClearEditorHistory"
      @cancel="showClearEditorHistoryModal = false"
    />

    <ConfirmModal
      :open="showDisableChatHistoryModal"
      :title="t('settings.disableChatHistoryConfirmTitle')"
      :message="t('settings.disableChatHistoryConfirmDialog')"
      :confirm-text="t('settings.disableChatHistoryConfirmButton')"
      danger
      @confirm="onDisableChatHistory"
      @cancel="showDisableChatHistoryModal = false"
    />

    <ConfirmModal
      :open="showClearChatHistoryModal"
      :title="t('history.clearConfirmTitle')"
      :message="t('settings.clearChatHistoryConfirmDialog')"
      :confirm-text="t('history.clearConfirmButton')"
      danger
      @confirm="onClearChatHistory"
      @cancel="showClearChatHistoryModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/useI18n'
import useToast from '../../composables/useToast'
import {
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
} from '../../lib/chat/chat-history-settings'
import { editorHistoryRetentionChoices } from '../../lib/history/editor-history-storage'
import {
  getNavigatorLanguages,
  resolveUiLanguagePreference,
  toHtmlLang,
} from '../../lib/locale/language'
import { useHistoryStore } from '../../stores/history'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldCheckbox from '../common/FieldCheckbox.vue'
import FieldInput from '../common/FieldInput.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import SettingsSection from '../common/SettingsSection.vue'

const props = defineProps<{
  userConfig: Record<string, any>
  effectiveAppLanguage?: string
}>()

const { t } = useI18n()
const { toast } = useToast()
const historyStore = useHistoryStore()

const showClearEditorHistoryModal = ref(false)

async function onClearEditorHistory() {
  showClearEditorHistoryModal.value = false
  await historyStore.clearEditorHistory()
  toast(t('history.cleared'), 'info')
}

const showClearChatHistoryModal = ref(false)

async function onClearChatHistory() {
  showClearChatHistoryModal.value = false
  await historyStore.clearChatHistory()
  toast(t('history.cleared'), 'info')
}

const showDisableChatHistoryModal = ref(false)

/** Shown off while the user confirms turning it off */
const chatHistoryChecked = computed(
  () =>
    isChatHistoryEnabled(props.userConfig) && !showDisableChatHistoryModal.value
)

/** Turning it off deletes the saved chats, so it asks first */
function setChatHistoryEnabled(enabled: boolean) {
  if (enabled) {
    props.userConfig.chatHistoryEnabled = true
    return
  }
  showDisableChatHistoryModal.value = true
}

function onDisableChatHistory() {
  showDisableChatHistoryModal.value = false
  props.userConfig.chatHistoryEnabled = false
}

function setChatHistoryRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  props.userConfig.chatHistoryRetentionDays = parsed
}

function setEditorHistoryLimit(value: string) {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 1) return
  props.userConfig.editorHistoryMaxItems = Math.round(parsed)
}

function setEditorHistoryRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  props.userConfig.editorHistoryRetentionDays = parsed
}

const currentLanguage = computed(() => {
  if (props.effectiveAppLanguage) {
    return props.effectiveAppLanguage
  }
  return resolveUiLanguagePreference(
    props.userConfig.appLanguage,
    props.userConfig.userLanguage,
    getNavigatorLanguages()
  )
})

const editorHistoryStorageOptions = computed(() => [
  { id: 'disk', name: t('settings.editorHistoryStorageDisk') },
  { id: 'session', name: t('settings.editorHistoryStorageSession') },
  { id: 'off', name: t('settings.editorHistoryStorageOff') },
])

const retentionOptions = (choices: number[], foreverLabel: string) => {
  const format = new Intl.NumberFormat(toHtmlLang(currentLanguage.value), {
    style: 'unit',
    unit: 'day',
    unitDisplay: 'long',
  })

  return choices.map((days) => ({
    id: days,
    name: days === 0 ? foreverLabel : format.format(days),
  }))
}

const editorHistoryRetentionOptions = computed(() =>
  retentionOptions(
    editorHistoryRetentionChoices(props.userConfig.editorHistoryRetentionDays),
    t('settings.editorHistoryRetentionForever')
  )
)

const chatHistoryRetentionOptions = computed(() =>
  retentionOptions(
    chatHistoryRetentionChoices(props.userConfig.chatHistoryRetentionDays),
    t('settings.chatHistoryRetentionNever')
  )
)
</script>

<style scoped>
.editor-history-nested {
  background-color: var(--app-surface-sunken);
  border-top: 1px solid var(--app-border-subtle);
  border-left: 2px solid var(--app-border-strong);
}

.editor-history-nested :deep(.field-row + .field-row) {
  border-top: none;
}
</style>
