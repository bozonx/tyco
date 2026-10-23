<template>
  <div class="settings-stack">
    <SettingsSection :title="t('settings.sectionEditorHistory')">
      <template #actions>
        <Button
          size="xs"
          variant="ghost"
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
            v-model="userConfig.editor.history.storage"
            :options="editorHistoryStorageOptions"
          />
        </FieldRow>
        <div
          v-if="userConfig.editor.history.storage !== 'off'"
          class="editor-history-nested"
        >
          <FieldRow
            :label="t('settings.editorHistoryMaxItems')"
            nested
            :separator="false"
          >
            <FieldNumber
              :min="1"
              :step="1"
              :model-value="userConfig.editor.history.maxItems"
              @update:model-value="setEditorHistoryLimit"
            />
          </FieldRow>
          <template v-if="userConfig.editor.history.storage === 'disk'">
            <FieldRow
              :label="t('settings.editorHistoryRetentionDays')"
              :info="t('settings.editorHistoryRetentionDaysHint')"
              nested
              :separator="false"
            >
              <FieldSelect
                :model-value="userConfig.editor.history.retentionDays ?? 0"
                :options="editorHistoryRetentionOptions"
                @update:model-value="setEditorHistoryRetentionDays"
              />
            </FieldRow>
            <FieldRow
              :label="t('settings.sanitizeSecretsInEditorHistory')"
              :info="t('settings.sanitizeSecretsInEditorHistoryHint')"
              nested
              :separator="false"
            >
              <FieldSwitch
                :model-value="
                  userConfig.editor.history.isSecretSanitizingEnabled ?? false
                "
                @update:model-value="
                  userConfig.editor.history.isSecretSanitizingEnabled = $event
                "
              />
            </FieldRow>
          </template>
        </div>
      </div>
    </SettingsSection>

    <SettingsSection :title="t('settings.sectionChatHistory')">
      <template #actions>
        <Button
          size="xs"
          variant="ghost"
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
          <FieldSwitch
            :model-value="chatHistoryChecked"
            @update:model-value="setChatHistoryEnabled"
          />
        </FieldRow>
        <div v-if="chatHistoryChecked" class="editor-history-nested">
          <FieldRow
            :label="t('settings.chatHistoryRetentionDays')"
            :info="t('settings.chatHistoryRetentionDaysHint')"
            nested
            :separator="false"
          >
            <FieldSelect
              :model-value="userConfig.chat.history.retentionDays ?? 0"
              :options="chatHistoryRetentionOptions"
              @update:model-value="setChatHistoryRetentionDays"
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
      :message="t('settings.clearChatsConfirmDialog')"
      :confirm-text="t('history.clearConfirmButton')"
      danger
      @confirm="onClearChatHistory"
      @cancel="showClearChatHistoryModal = false"
    />
  </div>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue'

import { useI18n } from '../../composables/use-i18n'
import { useSettingsContext } from '../../composables/use-settings-context'
import useToast from '../../composables/use-toast'
import {
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
} from '../../lib/chat/chat-history-settings'
import { editorHistoryRetentionChoices } from '../../lib/history/editor-history-storage'
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

const showClearEditorHistoryModal = ref(false)

async function onClearEditorHistory() {
  showClearEditorHistoryModal.value = false
  await historyStore.clearEditorHistory()
  toastKey('history.cleared', 'info')
}

const showClearChatHistoryModal = ref(false)

async function onClearChatHistory() {
  showClearChatHistoryModal.value = false
  await historyStore.clearChats()
  toastKey('history.cleared', 'info')
}

const showDisableChatHistoryModal = ref(false)

/** Shown off while the user confirms turning it off */
const chatHistoryChecked = computed(
  () =>
    isChatHistoryEnabled(userConfig.value) && !showDisableChatHistoryModal.value
)

/** Turning it off deletes the saved chats, so it asks first */
function setChatHistoryEnabled(enabled: boolean) {
  if (enabled) {
    userConfig.value.chat.history.storage = 'disk'
    return
  }
  showDisableChatHistoryModal.value = true
}

function onDisableChatHistory() {
  showDisableChatHistoryModal.value = false
  userConfig.value.chat.history.storage = 'off'
}

function setChatHistoryRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  const { history } = userConfig.value.chat
  if (parsed === 0) delete history.retentionDays
  else history.retentionDays = parsed
}

function setEditorHistoryLimit(value: string) {
  const parsed = Number(value)
  if (value.trim() === '' || !Number.isFinite(parsed) || parsed < 1) return
  userConfig.value.editor.history.maxItems = Math.round(parsed)
}

function setEditorHistoryRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  const { history } = userConfig.value.editor
  if (parsed === 0) delete history.retentionDays
  else history.retentionDays = parsed
}

const editorHistoryStorageOptions = computed(() => [
  { id: 'disk', name: t('settings.editorHistoryStorageDisk') },
  { id: 'session', name: t('settings.editorHistoryStorageSession') },
  { id: 'off', name: t('settings.editorHistoryStorageOff') },
])

const retentionOptions = (choices: number[], foreverLabel: string) => {
  const format = new Intl.NumberFormat(toHtmlLang(effectiveAppLanguage.value), {
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
    editorHistoryRetentionChoices(
      userConfig.value.editor.history.retentionDays
    ),
    t('settings.editorHistoryRetentionForever')
  )
)

const chatHistoryRetentionOptions = computed(() =>
  retentionOptions(
    chatHistoryRetentionChoices(userConfig.value.chat.history.retentionDays),
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
</style>
