<template>
  <SettingsSection :title="t('settings.sectionChatHistory')">
    <FieldRow
      :label="t('settings.chatHistoryEnabled')"
      :hint="t('settings.chatHistoryEnabledHint')"
      inline
    >
      <FieldSwitch
        :model-value="isHistoryChecked"
        @update:model-value="setHistoryEnabled"
      />
    </FieldRow>

    <FieldRow
      v-if="isHistoryChecked"
      :label="t('settings.chatHistoryRetentionDays')"
      :hint="t('settings.chatHistoryRetentionDaysHint')"
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

    <FieldRow :label="t('history.clear')" inline>
      <Button
        size="sm"
        variant="danger-ghost"
        icon="mdi:trash-can-outline"
        @click="showClearModal = true"
      >
        {{ t('history.clear') }}
      </Button>
    </FieldRow>

    <ConfirmModal
      :open="showDisableModal"
      :title="t('settings.disableChatHistoryConfirmTitle')"
      :message="t('settings.disableChatHistoryConfirmDialog')"
      :confirm-text="t('settings.disableChatHistoryConfirmButton')"
      danger
      @confirm="onDisable"
      @cancel="showDisableModal = false"
    />

    <ConfirmModal
      :open="showClearModal"
      :title="t('history.clearConfirmTitle')"
      :message="t('settings.clearChatsConfirmDialog')"
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
import {
  chatHistoryRetentionChoices,
  isChatHistoryEnabled,
} from '../../lib/chat/chat-history-settings'
import { historyRetentionOptions } from '../../lib/history/history-retention'
import { toHtmlLang } from '../../lib/locale/language'
import { useHistoryStore } from '../../stores/history'
import Button from '../common/Button.vue'
import ConfirmModal from '../common/ConfirmModal.vue'
import FieldRow from '../common/FieldRow.vue'
import FieldSelect from '../common/FieldSelect.vue'
import FieldSwitch from '../common/FieldSwitch.vue'
import SettingsSection from './SettingsSection.vue'

const { t } = useI18n()
const { draft: userConfig, effectiveAppLanguage } = useSettingsContext()
const { toastKey } = useToast()
const historyStore = useHistoryStore()

const history = computed(() => userConfig.value.chat.history)

const showClearModal = ref(false)

async function onClear() {
  showClearModal.value = false
  await historyStore.clearChats()
  toastKey('history.cleared', 'info')
}

const showDisableModal = ref(false)

/** Shown off while the user confirms turning it off */
const isHistoryChecked = computed(
  () => isChatHistoryEnabled(userConfig.value) && !showDisableModal.value
)

/** Turning it off deletes the saved chats, so it asks first */
function setHistoryEnabled(isEnabled: boolean) {
  if (isEnabled) {
    history.value.storage = 'disk'
    return
  }
  showDisableModal.value = true
}

function onDisable() {
  showDisableModal.value = false
  history.value.storage = 'off'
}

function setRetentionDays(value: number | string | undefined) {
  const parsed = Number(value)
  if (!Number.isInteger(parsed) || parsed < 0) return
  if (parsed === 0) delete history.value.retentionDays
  else history.value.retentionDays = parsed
}

const retentionOptions = computed(() =>
  historyRetentionOptions(
    chatHistoryRetentionChoices(history.value.retentionDays),
    toHtmlLang(effectiveAppLanguage.value),
    t('settings.chatHistoryRetentionNever')
  )
)
</script>
